// Every source of heartbeats looks the same to the rest of the app:
//   'beat'   {t: seconds on the performance clock, ibi: ms}
//   'pulse'  {t, v}  optional raw pulse-wave sample, for the live wave view
//   'status' {text, state: 'on'|'off'|'warn'|'busy'}

export class Device extends EventTarget {
  constructor(id, label) {
    super();
    this.id = id;
    this.label = label;
    this.kind = 'sensor'; // 'sensor' measures a real heart, 'practice' does not
    this.state = 'off';
    this.text = '';
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  status(text, state = 'busy') {
    this.text = text; this.state = state;
    this.emit('status', { text, state });
  }

  /** null when usable, else a sentence saying why not. */
  static support() { return null; }

  async connect() {}
  async disconnect() {}
}
