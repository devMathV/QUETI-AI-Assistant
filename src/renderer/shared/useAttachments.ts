import { useEffect, useState } from 'react'
import type { AttachmentInfo } from '../../shared/types'

export function useAttachments(): AttachmentInfo[] {
  const [list, setList] = useState<AttachmentInfo[]>([])
  useEffect(() => {
    let active = true
    const off = window.api.attachments.onChanged((l) => active && setList(l))
    void window.api.attachments.list().then((l) => active && setList(l))
    return () => {
      active = false
      off()
    }
  }, [])
  return list
}
