import { Check, FileWarning } from 'lucide-react'

/**
 * Shows whether an action's preconditions are satisfied. With no reasons it
 * renders a ready state; otherwise it lists the blocking reasons.
 */
export function ActionBlockers({ title, reasons }: { title: string; reasons: string[] }) {
  return (
    <div className={reasons.length === 0 ? 'action-blockers ready' : 'action-blockers blocked'}>
      <div>
        {reasons.length === 0 ? <Check size={16} /> : <FileWarning size={16} />}
        <strong>{title}</strong>
      </div>
      {reasons.length > 0 ? (
        <ul>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : (
        <p>All required preconditions are satisfied.</p>
      )}
    </div>
  )
}
