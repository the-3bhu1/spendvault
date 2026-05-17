import React, { useState, useMemo, useEffect } from 'react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  isToday,
  parseISO,
  subDays,
  setMonth,
  setYear,
  getYear,
  getMonth
} from 'date-fns';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';

interface CustomDatePickerProps {
  value: string; // yyyy-MM-dd
  onChange: (date: string) => void;
  isOpen: boolean;
  onClose: () => void;
  label?: string;
}

type ViewMode = 'calendar' | 'selector';

const CustomDatePicker: React.FC<CustomDatePickerProps> = ({ 
  value, 
  onChange, 
  isOpen, 
  onClose,
  label = "Select Date"
}) => {
  const selectedDate = useMemo(() => value ? parseISO(value) : new Date(), [value]);
  const [viewDate, setViewDate] = useState(selectedDate);
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  
  const [yearPageOffset, setYearPageOffset] = useState(0);

  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  let endDate = endOfWeek(monthEnd);

  // Always show 6 rows (42 cells) for consistent height
  let calendarDays = eachDayOfInterval({ start: startDate, end: endDate });
  while (calendarDays.length < 42) {
    endDate = endOfWeek(new Date(endDate.getTime() + 86400000));
    calendarDays = eachDayOfInterval({ start: startDate, end: endDate });
  }

  const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // Show 8 years with active year at 4th position (center-ish)
  const VISIBLE_YEARS = 8;
  const activeYear = getYear(viewDate);
  const yearStart = activeYear - 3 + yearPageOffset;
  const visibleYears = Array.from({ length: VISIBLE_YEARS }, (_, i) => yearStart + i);

  // Reset year page offset when switching to selector
  useEffect(() => {
    if (viewMode === 'selector') {
      setYearPageOffset(0);
    }
  }, [viewMode]);

  const handlePrevMonth = () => setViewDate(subMonths(viewDate, 1));
  const handleNextMonth = () => setViewDate(addMonths(viewDate, 1));
  
  const handleToday = () => {
    const today = new Date();
    onChange(format(today, 'yyyy-MM-dd'));
    onClose();
  };

  const handleYesterday = () => {
    const yesterday = subDays(new Date(), 1);
    onChange(format(yesterday, 'yyyy-MM-dd'));
    onClose();
  };

  const handleDateSelect = (date: Date) => {
    onChange(format(date, 'yyyy-MM-dd'));
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="flex-col">
            <span className="text-xs text-muted uppercase font-bold text-mono" style={{ letterSpacing: '2px' }}>{label}</span>
            <h3 className="text-mono" style={{ fontSize: '1.25rem' }}>
              {format(selectedDate, 'EEE, d MMM yyyy')}
            </h3>
          </div>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="modal-body flex-col gap-4" style={{ padding: '1rem 1.5rem' }}>
          {/* Quick Shortcuts */}
          <div className="flex gap-2">
            <button 
              className="btn-secondary flex-1" 
              style={{ 
                padding: '0.75rem', 
                fontSize: '0.75rem', 
                borderRadius: '12px',
                background: isToday(selectedDate) ? 'var(--success)' : 'var(--bg-hover)',
                color: isToday(selectedDate) ? '#000' : 'var(--text-primary)',
                border: '1px solid #000',
                boxShadow: isToday(selectedDate) ? 'none' : '3px 3px 0 #000',
                transform: isToday(selectedDate) ? 'translate(2px, 2px)' : 'none',
              }}
              onClick={handleToday}
            >
              Today
            </button>
            <button 
              className="btn-secondary flex-1" 
              style={{ 
                padding: '0.75rem', 
                fontSize: '0.75rem', 
                borderRadius: '12px',
                background: isSameDay(selectedDate, subDays(new Date(), 1)) ? 'var(--success)' : 'var(--bg-hover)',
                color: isSameDay(selectedDate, subDays(new Date(), 1)) ? '#000' : 'var(--text-primary)',
                border: '1px solid #000',
                boxShadow: isSameDay(selectedDate, subDays(new Date(), 1)) ? 'none' : '3px 3px 0 #000',
                transform: isSameDay(selectedDate, subDays(new Date(), 1)) ? 'translate(2px, 2px)' : 'none',
              }}
              onClick={handleYesterday}
            >
              Yesterday
            </button>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '20px', padding: '1.25rem', border: '1px solid var(--border-color)', minHeight: '320px', display: 'flex', flexDirection: 'column' }}>
            
            {viewMode === 'calendar' ? (
              <>
                {/* Calendar Header */}
                <div className="flex justify-between align-center" style={{ marginBottom: '1.5rem' }}>
                  <button 
                    onClick={() => setViewMode('selector')}
                    className="flex align-center gap-2 text-mono uppercase clickable" 
                    style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, background: 'var(--bg-hover)', padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}
                  >
                    {format(viewDate, 'MMMM yyyy')}
                    <ChevronDown size={14} className="text-primary" />
                  </button>
                  <div className="flex gap-1">
                    <button 
                      onClick={handlePrevMonth}
                      className="flex-center"
                      style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button 
                      onClick={handleNextMonth}
                      className="flex-center"
                      style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>

                {/* Calendar Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                  {weekDays.map((day, i) => (
                    <div key={i} className="text-center text-xs text-muted font-bold" style={{ padding: '0.5rem 0' }}>
                      {day}
                    </div>
                  ))}
                  {calendarDays.map((date, i) => {
                    const isSelected = isSameDay(date, selectedDate);
                    const isCurrentMonth = isSameMonth(date, monthStart);
                    const isCurrentDay = isToday(date);

                    return (
                      <div
                        key={i}
                        onClick={() => handleDateSelect(date)}
                        className="flex-center text-mono clickable"
                        style={{
                          height: '40px',
                          fontSize: '0.8rem',
                          borderRadius: '10px',
                          background: isSelected ? 'var(--success)' : 'transparent',
                          color: isSelected ? '#000' : (isCurrentMonth ? 'var(--text-primary)' : 'var(--text-secondary)'),
                          opacity: isCurrentMonth ? 1 : 0.3,
                          position: 'relative',
                          fontWeight: isSelected || isCurrentDay ? 800 : 400
                        }}
                      >
                        {format(date, 'd')}
                        {isCurrentDay && !isSelected && (
                          <div style={{ 
                            position: 'absolute', 
                            bottom: '4px', 
                            width: '4px', 
                            height: '4px', 
                            borderRadius: '50%', 
                            background: 'var(--success)' 
                          }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex-col flex-1" style={{ minHeight: '0' }}>
                <div className="flex justify-between align-center" style={{ marginBottom: '1rem' }}>
                  <span className="text-xs font-bold text-muted uppercase tracking-widest">Jump to Date</span>
                  <button 
                    onClick={() => setViewMode('calendar')}
                    className="text-xs font-bold text-primary text-mono uppercase"
                  >
                    Back to Grid
                  </button>
                </div>
                
                <div className="flex gap-3" style={{ minHeight: '0' }}>
                  {/* Month Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', flex: 1 }}>
                    {months.map((m, i) => {
                      const isCurrent = getMonth(viewDate) === i;
                      return (
                        <button
                          key={m}
                          onClick={() => {
                            setViewDate(setMonth(viewDate, i));
                            setViewMode('calendar');
                          }}
                          className="text-mono uppercase"
                          style={{
                            padding: '0.5rem 0',
                            borderRadius: '10px',
                            fontSize: '0.75rem',
                            fontWeight: isCurrent ? 800 : 400,
                            background: isCurrent ? 'var(--primary-soft)' : 'var(--bg-hover)',
                            border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--border-color)'}`,
                            color: isCurrent ? 'var(--accent)' : 'var(--text-primary)'
                          }}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>

                  {/* Year Column */}
                  <div 
                    style={{ 
                      width: '80px', 
                      display: 'flex', 
                      flexDirection: 'column', 
                      paddingLeft: '12px',
                      borderLeft: '1px solid var(--border-color)'
                    }}
                  >
                    <button 
                      onClick={() => setYearPageOffset(prev => prev - 4)}
                      className="flex-center text-muted"
                      style={{ padding: '0.2rem 0', flexShrink: 0 }}
                    >
                      <ChevronLeft size={14} style={{ transform: 'rotate(90deg)' }} />
                    </button>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flex: 1 }}>
                      {visibleYears.map(y => {
                        const isCurrent = getYear(viewDate) === y;
                        return (
                          <button
                            key={y}
                            onClick={() => setViewDate(setYear(viewDate, y))}
                            className="text-mono"
                            style={{
                              padding: '0.35rem 0',
                              borderRadius: '8px',
                              fontSize: '0.8rem',
                              fontWeight: isCurrent ? 800 : 400,
                              background: isCurrent ? 'var(--primary-soft)' : 'transparent',
                              color: isCurrent ? 'var(--accent)' : 'var(--text-secondary)',
                              flex: 1
                            }}
                          >
                            {y}
                          </button>
                        );
                      })}
                    </div>
                    <button 
                      onClick={() => setYearPageOffset(prev => prev + 4)}
                      className="flex-center text-muted"
                      style={{ padding: '0.2rem 0', flexShrink: 0 }}
                    >
                      <ChevronLeft size={14} style={{ transform: 'rotate(-90deg)' }} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomDatePicker;
