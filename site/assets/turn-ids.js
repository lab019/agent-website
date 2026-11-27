/*
 * Which streamed events still belong on the home's screen.
 *
 * Every event of an answer carries the messageId that send() returned. Once a question leaves the screen (answered,
 * stopped, or closed here because the stop came too early or failed), whatever its run still streams is late and must
 * not reopen a bubble or close the next question.
 */
const KEEP = 20

export function createTurnIds() {
  let current = null // the question on screen, once the gateway accepted it
  const dropped = new Set()

  return {
    start(id) {
      current = id || null
    },
    // the question left the screen: its late events are ignored from now on
    drop(id = current) {
      if (id === current) current = null
      if (!id) return
      dropped.add(id)
      if (dropped.size > KEEP) dropped.delete(dropped.values().next().value)
    },
    stale(event) {
      const id = event && event.messageId
      if (!id) return false
      if (dropped.has(id)) return true
      return current !== null && id !== current
    },
  }
}
