import { useEffect, useState } from 'react'
import type { AttachmentInfo } from '../../shared/types'

export function useAttachments(): AttachmentInfo[] {
  const [list, setList] = useState<AttachmentInfo[]>([])
  useEffect(() => {
    let active = true
    let receivedUpdate = false
    const off = window.api.attachments.onChanged((l) => {
      receivedUpdate = true
      if (active) setList(l)
    })
    void window.api.attachments.list().then((l) => {
      if (active && !receivedUpdate) setList(l)
    })
    return () => {
      active = false
      off()
    }
  }, [])
  return list
}
