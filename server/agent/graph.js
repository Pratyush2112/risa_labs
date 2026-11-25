// The analyst as an explicit LangGraph state machine.
//
//   START → router → load_context → agent ─┬─(tool calls)──→ tools ─→ agent
//                                     ├─(final draft)─→ verify ─┬─(untraced figures, 1st time)→ agent
//                                     │                         └─(ok / already revised)──────→ finalize → END
//                                     └─(step budget used)────→ finalize → END
import { StateGraph, Annotation, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { route as classify } from './router.js';
import { buildSystemPrompt } from './prompt.js';
import { checkGrounding } from './grounding.js';
import { snapshotForAI } from '../../shared/metrics.js';

const MAX_AGENT_STEPS = 6;

const GraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  asOf: Annotation(),
  route: Annotation(),
  context: Annotation(),
  agentSteps: Annotation({ reducer: (a, b) => a + b, default: () => 0 }),
  revisions: Annotation({ reducer: (a, b) => a + b, default: () => 0 }),
  needsRevision: Annotation({ reducer: (_a, b) => b, default: () => false }),
  grounding: Annotation(),
  answer: Annotation(),
  stopReason: Annotation(),
});

const textOf = (msg) => {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) return msg.content.filter((p) => p.type === 'text' && !p.thought).map((p) => p.text).join('\n');
  return '';
};
const isHuman = (m) => m?._getType?.() === 'human' || m?.getType?.() === 'human';
const lastHumanText = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) if (isHuman(messages[i]) && !textOf(messages[i]).startsWith('[Grounding check]')) return textOf(messages[i]);
  return '';
};

export function buildGraph({ model, tools, ctx }) {
  const llm = model.bindTools(tools);
  const toolNode = new ToolNode(tools);

  // 1. Router — deterministic intent, entities and known data gaps.
  async function router(state) {
    return { route: classify(lastHumanText(state.messages), ctx.campaigns) };
  }

  // 2. Context — fetch the snapshot for the requested date (a date named in the question wins).
  async function context(state) {
    const date = state.route.dates.length === 1 ? state.route.dates[0] : state.asOf;
    const derived = await ctx.getDerived(date);
    const snap = snapshotForAI(derived);
    ctx.evidence.push(snap);
    return { context: snap };
  }

  // 3. Agent — the model reasons and calls tools.
  async function agent(state) {
    const system = new SystemMessage(buildSystemPrompt({
      asOf: state.asOf, route: state.route, context: state.context, owners: ctx.owners, campaigns: ctx.campaigns,
    }));
    const response = await llm.invoke([system, ...state.messages]);
    return { messages: [response], agentSteps: 1 };
  }

  function afterAgent(state) {
    const last = state.messages.at(-1);
    if (last?.tool_calls?.length) return state.agentSteps >= MAX_AGENT_STEPS ? 'finalize' : 'tools';
    return 'verify';
  }

  // 4. Verify — every figure in the draft must trace to evidence.
  async function verify(state) {
    const draft = textOf(state.messages.at(-1));
    const userText = state.messages.filter(isHuman).map(textOf);
    const report = checkGrounding(draft, [...ctx.evidence, ...userText]);
    if (report.unsupported.length && state.revisions < 1) {
      return {
        grounding: report,
        needsRevision: true,
        revisions: 1,
        messages: [new HumanMessage(
          `[Grounding check] These figures in your draft do not appear in any tool result: ${report.unsupported.join(', ')}. ` +
          'Recompute each one with calculate or another tool, or remove it. Then give the final answer only (do not mention this check).',
        )],
      };
    }
    return { grounding: report, needsRevision: false };
  }
  const afterVerify = (state) => (state.needsRevision ? 'agent' : 'finalize');

  // 5. Finalize — package the answer.
  async function finalize(state) {
    const last = state.messages.at(-1);
    if (last?.tool_calls?.length) {
      return { answer: 'I needed more steps than allowed for this question. Please ask a narrower question (one campaign, one metric or one date).', stopReason: 'step_limit' };
    }
    return { answer: textOf(last) || 'I could not produce an answer. Please rephrase the question.', stopReason: 'done' };
  }

  return new StateGraph(GraphState)
    .addNode('router', router)
    .addNode('load_context', context)
    .addNode('agent', agent)
    .addNode('tools', toolNode)
    .addNode('verify', verify)
    .addNode('finalize', finalize)
    .addEdge(START, 'router')
    .addEdge('router', 'load_context')
    .addEdge('load_context', 'agent')
    .addConditionalEdges('agent', afterAgent, ['tools', 'verify', 'finalize'])
    .addEdge('tools', 'agent')
    .addConditionalEdges('verify', afterVerify, ['agent', 'finalize'])
    .addEdge('finalize', END)
    .compile();
}
