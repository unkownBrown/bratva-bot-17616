// Antrian lagu per server. Logika murni (tanpa Discord) supaya mudah dites.
const LOOPS = ['mati', 'lagu', 'antrian'];

class Antrian {
  constructor() {
    this.items = [];
    this.current = null;
    this.loop = 'mati';
  }

  get size() {
    return this.items.length;
  }

  // Tambah lagu. next = taruh paling depan. Mengembalikan jumlah yang benar-benar masuk (dibatasi max).
  add(tracks, { next = false, max = 200 } = {}) {
    const room = Math.max(0, max - this.items.length);
    const take = tracks.slice(0, room);
    if (next) this.items.unshift(...take);
    else this.items.push(...take);
    return take.length;
  }

  // Maju ke lagu berikutnya.
  //  skipped: dilewati manual (loop "lagu" tidak mengulang lagu yang sama)
  //  drop: lagu sekarang gagal diputar, jangan dimasukkan lagi ke antrian walau loop "antrian"
  advance({ skipped = false, drop = false } = {}) {
    const prev = this.current;
    if (prev && !drop) {
      if (this.loop === 'lagu' && !skipped) return prev;
      if (this.loop === 'antrian') this.items.push(prev);
    }
    this.current = this.items.shift() ?? null;
    return this.current;
  }

  setLoop(mode) {
    if (!LOOPS.includes(mode)) throw new Error('Mode loop harus mati, lagu, atau antrian.');
    this.loop = mode;
    return mode;
  }

  cycleLoop() {
    return this.setLoop(LOOPS[(LOOPS.indexOf(this.loop) + 1) % LOOPS.length]);
  }

  shuffle() {
    for (let i = this.items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    }
  }

  // Hapus lagu nomor n (mulai dari 1, sesuai tampilan antrian).
  remove(n) {
    if (!Number.isInteger(n) || n < 1 || n > this.items.length) return null;
    return this.items.splice(n - 1, 1)[0];
  }

  clear() {
    this.items = [];
    this.current = null;
  }

  totalMs() {
    return this.items.reduce((sum, t) => sum + (t.durationMs || 0), 0);
  }
}

module.exports = { Antrian, LOOPS };
