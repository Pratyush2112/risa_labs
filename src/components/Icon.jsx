// Name → lucide icon. Pages keep using <Icon name="..." />; one stroke family everywhere.
import React from 'react';
import {
  LayoutDashboard, Megaphone, KanbanSquare, Flag, Database, BookOpen, MessageSquareText, X, ArrowUp,
  Check, TriangleAlert, Plus, Trash2, Pencil, RotateCcw, ChevronRight, ArrowRight, CalendarDays, User, Rows3,
} from 'lucide-react';

const MAP = {
  overview: LayoutDashboard, campaigns: Megaphone, tasks: KanbanSquare, bets: Flag, data: Database, method: BookOpen,
  chat: MessageSquareText, close: X, send: ArrowUp, check: Check, alert: TriangleAlert, plus: Plus, trash: Trash2,
  edit: Pencil, reset: RotateCcw, chevron: ChevronRight, arrowRight: ArrowRight, calendar: CalendarDays, user: User, database: Rows3,
};

export default function Icon({ name, size = 16, label, className = '' }) {
  const C = MAP[name] || MAP.chevron;
  return <C size={size} strokeWidth={1.75} className={`shrink-0 ${className}`} aria-label={label} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} />;
}
