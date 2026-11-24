# Momentz

Momentz is a prototype of an online AI study coach for university students. A student picks one moment from their week (a seminar, a lab, some individual study), talks it through with a coach by typing or speaking, and leaves with one small thing to try next time.

It is built to get past the reputation of "reflective writing" as vague or pointless. The words *reflection* and *debrief* don't appear in the interface. Every conversation ends with a concrete, testable action rather than an essay.

This repo holds a **clickable design prototype**: five screens with working navigation and interactions. There is no AI behind it yet. The coach's lines are scripted to show how a conversation should feel.

## Try it

Open `index.html` in a browser, or turn on GitHub Pages for this repo (Settings › Pages › deploy from the `main` branch, root folder). There's no build step and nothing to install.

## The flow

The design separates **before**, **during** and **after** the conversation, so that during it the student sees nothing but the chat.

| Screen | File | What it shows |
| --- | --- | --- |
| Home (before) | `index.html` | The student names one moment and chooses typing or speaking. |
| Chat: the opening (during) | `chat-opening.html` | Chat only. The coach asks for the story; the student's speech is transcribed live. |
| Chat: later (during) | `chat.html` | Expectations vs. what happened, what got in the way, places to look, and an opt-in to compare with earlier moments. |
| Your moment (after) | `summary.html` | The "When… I'll…" action to edit, a date to try it, a check-in, and an optional one-line summary. |
| Playbook (after) | `playbook.html` | Everything the student has tried, marked new, trying or working. |

Interactive in the prototype: the typing/speaking toggle, the coach's "places to look" (each changes the follow-up question), the optional summary, the check-in toggle and the playbook filters.

## How the coach works

The conversation follows the After Action Review: what you expected, what happened, why there was a difference, what you'll do next. It ends with an implementation intention ("When… I'll…").

The central rule is **signpost, don't supply**. The coach can point the student towards places worth looking (timing, how ready an idea felt, finding the words, what others were doing), but it never states the insight, the cause or the action for them. Everything the student keeps is written in their own words.

## Repo layout

```
index.html, chat-opening.html, chat.html, summary.html, playbook.html   runnable screens
runtime.js        renders the screens in a plain browser (no dependencies)
design/           source files from the design canvas (*.dc.html, canvas.json)
scripts/build.py  rebuilds the runnable screens from design/
```

To update the prototype after changing a file in `design/`, run:

```
python3 scripts/build.py
```
