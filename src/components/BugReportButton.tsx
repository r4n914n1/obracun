import { useState } from 'react'
import { useLocale } from '../i18n/LocaleContext'
import { BugReportDialog } from './BugReportDialog'

interface BugReportButtonProps {
  className?: string
  title?: string
}

export function BugReportButton({ className, title }: BugReportButtonProps) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={className}
        title={title ?? t('bugReportTitle')}
        onClick={() => setOpen(true)}
      >
        {t('bugReport')}
      </button>
      <BugReportDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
