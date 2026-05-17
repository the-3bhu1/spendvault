import React from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  thirdLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onThirdAction?: () => void;
  isDanger?: boolean;
  isAlert?: boolean;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  thirdLabel,
  onConfirm,
  onCancel,
  onThirdAction,
  isDanger = true,
  isAlert = false
}) => {
  if (!isOpen) return null;

  return (
    <div className="confirm-dialog-overlay" onClick={isAlert ? onConfirm : onCancel}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        <div className="confirm-dialog-body">
          <h3 className="confirm-dialog-title">{title}</h3>
          <p className="confirm-dialog-message">{message}</p>
        </div>
        <div className="confirm-dialog-actions" style={{ flexDirection: thirdLabel ? 'column' : 'row' }}>
          {!isAlert && (
            <button className="confirm-dialog-btn confirm-dialog-btn-cancel" onClick={onCancel} style={{ width: thirdLabel ? '100%' : '50%', borderBottom: thirdLabel ? '1px solid var(--border-color)' : 'none' }}>
              {cancelLabel}
            </button>
          )}
          {thirdLabel && onThirdAction && (
            <button 
              className="confirm-dialog-btn" 
              onClick={onThirdAction}
              style={{ width: '100%', borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)', fontWeight: 600 }}
            >
              {thirdLabel}
            </button>
          )}
          <button 
            className="confirm-dialog-btn confirm-dialog-btn-confirm" 
            onClick={onConfirm}
            style={{ 
              color: isDanger ? '#ef4444' : 'var(--accent)',
              width: isAlert || thirdLabel ? '100%' : '50%',
              borderLeft: isAlert || thirdLabel ? 'none' : '1px solid var(--border-color)'
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
