import { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronDown } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subDays, subMonths } from 'date-fns';

interface DateRangePickerProps {
  startDate: Date;
  endDate: Date;
  onChange: (start: Date, end: Date) => void;
}

const presets = [
  { label: 'Hoje', getRange: () => ({ start: new Date(), end: new Date() }) },
  { label: 'Ontem', getRange: () => ({ start: subDays(new Date(), 1), end: subDays(new Date(), 1) }) },
  { label: 'Ultimos 7 dias', getRange: () => ({ start: subDays(new Date(), 6), end: new Date() }) },
  { label: 'Este mes', getRange: () => ({ start: startOfMonth(new Date()), end: endOfMonth(new Date()) }) },
  { label: 'Mes passado', getRange: () => ({ start: startOfMonth(subMonths(new Date(), 1)), end: endOfMonth(subMonths(new Date(), 1)) }) },
];

export function DateRangePicker({ startDate, endDate, onChange }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localStart, setLocalStart] = useState(format(startDate, 'yyyy-MM-dd'));
  const [localEnd, setLocalEnd] = useState(format(endDate, 'yyyy-MM-dd'));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalStart(format(startDate, 'yyyy-MM-dd'));
    setLocalEnd(format(endDate, 'yyyy-MM-dd'));
  }, [startDate, endDate]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleApply = () => {
    onChange(new Date(localStart), new Date(localEnd));
    setIsOpen(false);
  };

  const handlePreset = (start: Date, end: Date) => {
    onChange(start, end);
    setLocalStart(format(start, 'yyyy-MM-dd'));
    setLocalEnd(format(end, 'yyyy-MM-dd'));
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="btn-secondary"
        style={{ fontSize: '13px' }}
      >
        <CalendarIcon size={16} />
        <span>{format(startDate, 'dd/MM/yyyy')} — {format(endDate, 'dd/MM/yyyy')}</span>
        <ChevronDown size={14} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 z-50 dropdown-menu p-3 min-w-[280px]">
          <div className="space-y-2 mb-3">
            {presets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => {
                  const { start, end } = preset.getRange();
                  handlePreset(start, end);
                }}
                className="dropdown-item w-full text-left"
                style={{ color: 'var(--text-secondary)', fontSize: '13px' }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                  Data inicial
                </label>
                <input
                  type="date"
                  value={localStart}
                  onChange={(e) => setLocalStart(e.target.value)}
                  className="input-dark w-full"
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                  Data final
                </label>
                <input
                  type="date"
                  value={localEnd}
                  onChange={(e) => setLocalEnd(e.target.value)}
                  className="input-dark w-full"
                />
              </div>
              <button onClick={handleApply} className="btn-primary w-full justify-center">
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
