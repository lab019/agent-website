/*
 * Rules of the home's chat controls, kept apart from the page so they can be tested on their own
 * (tests/sdk/home-controls.test.mjs). home.js only applies what they return to the DOM.
 */

// While the agent answers, the send button of the stage and of the bubble becomes the stop button.
export function sendButtons({ busy, stopping, booting, hasText }) {
  return {
    face: busy ? { stop: true, icon: '#i-stop', label: 'stop' } : { stop: false, icon: '#i-up', label: 'send' },
    stage: { disabled: busy ? stopping : booting || !hasText },
    panel: { disabled: busy && stopping },
  }
}

// Asks the gateway to stop the run. Right after send() the run may not be registered yet ({stopped:false}), so it
// asks once more after `retryMs`. It stops asking as soon as the question is no longer the one on screen.
export async function askStop(stop, { stillMine, retryMs, attempts = 2, wait = sleep }) {
  for (let attempt = 0; attempt < attempts && stillMine(); attempt += 1) {
    if (attempt) await wait(retryMs)
    if (!stillMine()) break
    try {
      if ((await stop()).stopped) return true
    } catch {
      // the stop did not reach the gateway
    }
  }
  return false
}

// Who holds the busy state. release() ends the cycle; whoever began one only releases it while it is still its own:
// a stop may have released it and a new question begun in the meantime.
export function busyCycles() {
  let current = null
  return {
    begin() {
      current = {}
      return current
    },
    owns(cycle) {
      return cycle !== null && current === cycle
    },
    end() {
      current = null
    },
  }
}

// The corner bubble: there is a conversation and the stage left the screen or was minimized.
export function bubble({ hasConversation, minimized, stageVisible }) {
  return {
    visible: hasConversation && (minimized || !stageVisible),
    low: minimized, // on the phone the top corner is the live badge's
    closePanel: stageVisible && !minimized, // the stage already shows the conversation
  }
}

const MINIMIZED_KEY = 'lab019:home:minimized'

// "Minimizar" lasts for the tab, across reloads. Blocked storage (even reading `sessionStorage` can throw) only
// means the choice is forgotten on the next page.
export function minimizedStore(storage) {
  return {
    read() {
      try {
        return storage().getItem(MINIMIZED_KEY) === '1'
      } catch {
        return false
      }
    },
    write(value) {
      try {
        if (value) storage().setItem(MINIMIZED_KEY, '1')
        else storage().removeItem(MINIMIZED_KEY)
      } catch {
        /* storage blocked */
      }
    },
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
