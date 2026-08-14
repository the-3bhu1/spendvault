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

  // With a third action the buttons stack, and Cancel sits last so the safe way out is
  // nearest the thumb. The two-button case stays a row, with Cancel on the left as usual.
  const isStacked = !!(thirdLabel && onThirdAction);
  const divider = '1px solid var(--border-color)';

  const cancelButton = !isAlert && (
    <button
      key="cancel"
      className="confirm-dialog-btn confirm-dialog-btn-cancel"
      onClick={onCancel}
      style={{
        width: isStacked ? '100%' : '50%',
        borderRight: isStacked ? 'none' : undefined,
        borderBottom: 'none'
      }}
    >
      {cancelLabel}
    </button>
  );

  const thirdButton = isStacked && (
    <button
      key="third"
      className="confirm-dialog-btn"
      onClick={onThirdAction}
      style={{ width: '100%', borderBottom: divider, color: 'var(--text-primary)', fontWeight: 600 }}
    >
      {thirdLabel}
    </button>
  );

  const confirmButton = (
    <button
      key="confirm"
      className="confirm-dialog-btn confirm-dialog-btn-confirm"
      onClick={onConfirm}
      style={{
        color: isDanger ? '#ef4444' : 'var(--accent)',
        width: isAlert || isStacked ? '100%' : '50%',
        borderLeft: isAlert || isStacked ? 'none' : divider,
        borderBottom: isStacked && !isAlert ? divider : 'none'
      }}
    >
      {confirmLabel}
    </button>
  );

  return (
    <div className="confirm-dialog-overlay" onClick={isAlert ? onConfirm : onCancel}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        <div className="confirm-dialog-body">
          <h3 className="confirm-dialog-title">{title}</h3>
          <p className="confirm-dialog-message">{message}</p>
        </div>
        <div className="confirm-dialog-actions" style={{ flexDirection: isStacked ? 'column' : 'row' }}>
          {isStacked
            ? [thirdButton, confirmButton, cancelButton]
            : [cancelButton, confirmButton]}
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
