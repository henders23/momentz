# Momentz

Momentz is an online AI study coach for university students. A student picks one moment from their week (a seminar, a lab, some individual study), talks it through with a coach by typing or speaking, and leaves with one small thing to try next time.

It is built to get past the reputation of "reflective writing" as vague or pointless. The words *reflection* and *debrief* don't appear in the interface. Every conversation ends with a concrete, testable action rather than an essay.

The coach is Claude, called through the Claude API.

## Run it

You need [Node.js](https://nodejs.org) 22.9 or newer and a Claude API key.

1. Create a key at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys). API use is billed to that account.
2. Install and configure:

   ```bash
   npm install
   ```

   ```bash
   cp .env.example .env
   ```

   Open `.env` and paste your key after `ANTHROPIC_API_KEY=`.
3. Start the app:

   ```bash
   npm start
   ```

4. Open <http://localhost:3000>.

Without a key the pages still load, and the chat tells you the coach isn't connected.

### On Vercel

The repository also deploys to [Vercel](https://vercel.com) as it is: Vercel serves `public/` and runs the server as a function for everything under `/api` (`vercel.json`, `api/index.js`). Add `ANTHROPIC_API_KEY` under the project's Settings → Environment Variables, then redeploy.

Two limits apply there:

- **Moments are not kept.** A function can only write to a temporary folder, which is emptied whenever it restarts, so moments and the playbook disappear after a period of no use and on every deploy. The home page says so. Keeping them needs a database or browser storage in place of `server/store.js`.
- **There is still no sign-in.** Keep Vercel's Deployment Protection switched on, or anyone with the address shares the one store and your API key.

## The flow

The design separates **before**, **during** and **after** the conversation, so that during it the student sees nothing but the chat.

| Screen | Page | What it does |
| --- | --- | --- |
| Home (before) | `index.html` | The student names one moment and chooses typing or speaking. |
| Chat (during) | `chat.html` | Chat only. The coach asks what happened, what was expected, what got in the way and what to try. It can offer "places to look" and, once there are earlier moments, a comparison with them. Speech is transcribed live. "Aa" helps the student put an answer into words. |
| Your moment (after) | `summary.html` | The "When… I'll…" action to edit, when to try it, a check-in toggle, an optional one-line summary, and an export of the notes. |
| Playbook (after) | `playbook.html` | Everything the student has decided to try, marked new, trying or working, with a log of how each attempt went. |

## How the coach works

The conversation follows the After Action Review: what you expected, what happened, why there was a difference, what you'll do next. It ends with an implementation intention ("When… I'll…").

The central rule is **signpost, don't supply**. The coach can point the student towards places worth looking (timing, how ready an idea felt, finding the words, what others were doing), but it never states the insight, the cause or the action for them. Everything the student keeps is written in their own words.

The coach's instructions are the `COACH_PROMPT` text at the top of `server/coach.js`. That is the place to change how it behaves.

## How the Claude API is connected

The browser never talks to Claude and never sees the API key. It calls this app's own server, and the server calls Claude with the official SDK (`@anthropic-ai/sdk`). All of it is in `server/coach.js`:

```js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const stream = client.messages.stream({
  model: 'claude-opus-5-5',
  max_tokens: 16000,
  system: [{ type: 'text', text: COACH_PROMPT }, { type: 'text', text: aboutThisMoment }],
  tools: TOOLS,          // buttons the coach can put in front of the student
  messages: moment.messages // the whole conversation so far
});
```

There are three calls:

| Call | Used for | How |
| --- | --- | --- |
| `coachTurn()` | Each coach reply | `messages.stream()`. Text is forwarded to the browser as it is written. |
| `summarise()` | The "Your moment" page | `messages.parse()` with a schema, so Claude returns JSON with fixed fields. |
| `helpSay()` | The "Aa" button | `messages.parse()` with a schema. |

Things worth knowing if you change it:

- **The API keeps no memory.** Every request sends the whole conversation, which the server stores per moment and appends to. Claude's replies are stored exactly as returned and sent back unchanged.
- **Buttons are tools.** "Places to look", "Yes, show me / Not now" and "See what you worked out" are three tools Claude can call. A tool call ends the coach's message; the button the student presses is sent back as the tool's result, and the coach carries on from there.
- **"In your words" is checked.** Quotes Claude lifts for the summary page are kept only if they really appear in what the student wrote.
- **The model** is `claude-opus-5-5`. Set `MOMENTZ_MODEL` in `.env` to use another, for example `claude-haiku-5-5` for lower cost.
- **Errors** such as a wrong key, a rate limit or no connection are turned into a plain message in the chat, and the unsent message is put back in the box.

## Privacy and limits

- Moments and the playbook are saved in `data/momentz.json` on the machine running the server. Delete that file to start again.
- The conversation is sent to Anthropic's API to get the coach's replies. Speaking uses the browser's speech recognition (Chrome, Edge, Safari), which in Chrome sends audio to Google.
- There are no accounts: the app holds one student's data, and by default the server only accepts connections from the same computer. Add sign-in and a per-user store before putting it on the internet.

## Repo layout

```
server/index.js     web server and /api routes
server/coach.js     every Claude API call, the coach prompt and its tools
server/store.js     JSON-file storage
public/             the four pages, their scripts (js/) and styles (css/app.css)
test/               end-to-end test with a scripted stand-in for the Claude API
design/             the original design-canvas files the screens were built from
api/, vercel.json   how Vercel runs the server
```

```bash
npm test
```

runs the test. It needs no API key and makes no real API calls.
