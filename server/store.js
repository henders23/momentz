// A small JSON-file store. Momentz is a single-student app, so one file on disk
// is enough: it is easy to read, back up and delete. Swap this module for a
// database if you add accounts.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const EMPTY = { profile: { name: '', course: '' }, moments: [], playbook: [] };

export class Store {
  constructor(file) {
    this.file = file;
    this.data = structuredClone(EMPTY);
    this.writing = Promise.resolve();
  }

  async load() {
    try {
      this.data = { ...structuredClone(EMPTY), ...JSON.parse(await readFile(this.file, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return this;
  }

  // Writes are queued so two requests can't interleave, and go through a temp
  // file so a crash mid-write can't leave a half-written store behind.
  save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, this.file);
    });
    return this.writing;
  }

  get profile() {
    return this.data.profile;
  }

  get moments() {
    return this.data.moments;
  }

  get playbook() {
    return this.data.playbook;
  }

  moment(id) {
    return this.data.moments.find((m) => m.id === id);
  }

  move(id) {
    return this.data.playbook.find((p) => p.id === id);
  }

  createMoment({ title, mode }) {
    const now = new Date().toISOString();
    const moment = {
      id: randomUUID(),
      title,
      mode: mode === 'speak' ? 'speak' : 'type',
      createdAt: now,
      updatedAt: now,
      // The conversation exactly as it is sent to the Claude API.
      messages: [],
      // Per-message display details the API doesn't need, keyed by message index.
      meta: {},
      comparedEarlier: false,
      summary: null,
      summaryAtLength: 0,
      takeaway: '',
      checkIn: true,
      tryDate: '',
      playbookId: null
    };
    this.data.moments.unshift(moment);
    return moment;
  }

  deleteMoment(id) {
    this.data.moments = this.data.moments.filter((m) => m.id !== id);
    for (const move of this.data.playbook) {
      if (move.momentId === id) move.momentId = null;
    }
  }

  createMove(fields) {
    const move = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'new',
      log: [],
      ...fields
    };
    this.data.playbook.unshift(move);
    return move;
  }

  deleteMove(id) {
    this.data.playbook = this.data.playbook.filter((p) => p.id !== id);
    for (const moment of this.data.moments) {
      if (moment.playbookId === id) moment.playbookId = null;
    }
  }
}
