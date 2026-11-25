// Bank soal kuis bawaan. j[0] = jawaban benar, sisanya pengecoh (urutannya diacak waktu dimainkan).
// Soal buatan pengelola (disimpan di data/game.json) ikut masuk ke kategori "Server".
const { kocok } = require('./games');

const KATEGORI = { campur: 'Campuran', indonesia: 'Indonesia', sains: 'Sains', umum: 'Umum', game: 'Game & teknologi', server: 'Soal server' };

const BAWAAN = [
  // ---------- Indonesia ----------
  { k: 'indonesia', t: 'Siapa proklamator kemerdekaan Indonesia bersama Soekarno?', j: ['Mohammad Hatta', 'Sutan Sjahrir', 'Ahmad Soebardjo', 'Tan Malaka'] },
  { k: 'indonesia', t: 'Tanggal berapa Indonesia memproklamasikan kemerdekaan?', j: ['17 Agustus 1945', '1 Juni 1945', '28 Oktober 1928', '20 Mei 1908'] },
  { k: 'indonesia', t: 'Gunung tertinggi di Indonesia adalah...', j: ['Puncak Jaya', 'Semeru', 'Rinjani', 'Kerinci'] },
  { k: 'indonesia', t: 'Danau terbesar di Indonesia adalah...', j: ['Danau Toba', 'Danau Singkarak', 'Danau Poso', 'Danau Tempe'] },
  { k: 'indonesia', t: 'Pulau terluas yang seluruhnya milik Indonesia adalah...', j: ['Sumatra', 'Jawa', 'Sulawesi', 'Bali'] },
  { k: 'indonesia', t: 'Siapa pencipta lagu kebangsaan Indonesia Raya?', j: ['W.R. Supratman', 'Ismail Marzuki', 'Kusbini', 'C. Simanjuntak'] },
  { k: 'indonesia', t: 'Candi Buddha terbesar di dunia ada di Magelang. Namanya...', j: ['Borobudur', 'Prambanan', 'Mendut', 'Sewu'] },
  { k: 'indonesia', t: 'Sumpah Pemuda diikrarkan pada tahun...', j: ['1928', '1908', '1945', '1950'] },
  { k: 'indonesia', t: 'Tari Saman berasal dari daerah...', j: ['Aceh', 'Bali', 'Papua', 'Sulawesi Selatan'] },
  { k: 'indonesia', t: 'Rumah adat Minangkabau disebut...', j: ['Rumah Gadang', 'Joglo', 'Honai', 'Tongkonan'] },
  { k: 'indonesia', t: 'Alat musik tradisional dari bambu yang terkenal dari Jawa Barat adalah...', j: ['Angklung', 'Sasando', 'Kolintang', 'Tifa'] },
  { k: 'indonesia', t: 'UNESCO menetapkan batik sebagai warisan budaya tak benda pada tahun...', j: ['2009', '2005', '2012', '2015'] },
  { k: 'indonesia', t: 'Selat yang memisahkan Pulau Jawa dan Pulau Sumatra adalah...', j: ['Selat Sunda', 'Selat Bali', 'Selat Makassar', 'Selat Malaka'] },
  { k: 'indonesia', t: 'Kota mana yang dijuluki Kota Pahlawan?', j: ['Surabaya', 'Bandung', 'Semarang', 'Medan'] },
  { k: 'indonesia', t: 'Ibu kota provinsi Sulawesi Selatan adalah...', j: ['Makassar', 'Manado', 'Palu', 'Kendari'] },
  { k: 'indonesia', t: 'Presiden ketiga Republik Indonesia adalah...', j: ['B.J. Habibie', 'Soeharto', 'Abdurrahman Wahid', 'Megawati Soekarnoputri'] },
  { k: 'indonesia', t: 'Wakil presiden pertama Republik Indonesia adalah...', j: ['Mohammad Hatta', 'Adam Malik', 'Sri Sultan Hamengkubuwono IX', 'Sutan Sjahrir'] },
  { k: 'indonesia', t: 'Kerajaan Hindu tertua di Indonesia adalah...', j: ['Kutai', 'Majapahit', 'Sriwijaya', 'Mataram Kuno'] },
  { k: 'indonesia', t: 'Rendang adalah masakan khas dari...', j: ['Minangkabau', 'Betawi', 'Sunda', 'Bugis'] },
  { k: 'indonesia', t: 'Gudeg adalah makanan khas kota...', j: ['Yogyakarta', 'Palembang', 'Medan', 'Makassar'] },
  { k: 'indonesia', t: 'Pempek adalah makanan khas kota...', j: ['Palembang', 'Padang', 'Banjarmasin', 'Pontianak'] },
  { k: 'indonesia', t: 'Papeda adalah makanan pokok khas dari...', j: ['Maluku dan Papua', 'Sumatra Barat', 'Bali', 'Aceh'] },
  { k: 'indonesia', t: 'Bahan utama pembuatan tempe adalah...', j: ['Kedelai', 'Kacang tanah', 'Jagung', 'Singkong'] },
  { k: 'indonesia', t: 'Bank sentral Indonesia adalah...', j: ['Bank Indonesia', 'Bank Mandiri', 'Bank Rakyat Indonesia', 'Otoritas Jasa Keuangan'] },
  { k: 'indonesia', t: 'Singkatan "KTP" adalah...', j: ['Kartu Tanda Penduduk', 'Kartu Tanda Pegawai', 'Kartu Tanda Pelajar', 'Kartu Tanda Pengenal'] },
  // ---------- Sains ----------
  { k: 'sains', t: 'Planet yang paling dekat dengan Matahari adalah...', j: ['Merkurius', 'Venus', 'Mars', 'Bumi'] },
  { k: 'sains', t: 'Planet terbesar di tata surya adalah...', j: ['Jupiter', 'Saturnus', 'Neptunus', 'Uranus'] },
  { k: 'sains', t: 'Planet yang dijuluki Planet Merah adalah...', j: ['Mars', 'Merkurius', 'Jupiter', 'Venus'] },
  { k: 'sains', t: 'Gas yang paling banyak terkandung di atmosfer Bumi adalah...', j: ['Nitrogen', 'Oksigen', 'Karbon dioksida', 'Hidrogen'] },
  { k: 'sains', t: 'Berapa jumlah tulang pada tubuh manusia dewasa?', j: ['206', '186', '256', '306'] },
  { k: 'sains', t: 'Zat hijau pada daun yang berperan dalam fotosintesis disebut...', j: ['Klorofil', 'Stomata', 'Xilem', 'Kutikula'] },
  { k: 'sains', t: 'Lambang unsur kimia untuk emas adalah...', j: ['Au', 'Ag', 'Fe', 'Go'] },
  { k: 'sains', t: 'Hewan darat tercepat di dunia adalah...', j: ['Cheetah', 'Singa', 'Kuda', 'Macan tutul'] },
  { k: 'sains', t: 'Mamalia terbesar di dunia adalah...', j: ['Paus biru', 'Gajah afrika', 'Hiu paus', 'Jerapah'] },
  { k: 'sains', t: 'Jumlah sudut dalam sebuah segitiga adalah...', j: ['180 derajat', '90 derajat', '270 derajat', '360 derajat'] },
  { k: 'sains', t: 'Satuan kuat arus listrik adalah...', j: ['Ampere', 'Volt', 'Watt', 'Ohm'] },
  { k: 'sains', t: 'Titik didih air di permukaan laut adalah...', j: ['100 derajat Celsius', '90 derajat Celsius', '120 derajat Celsius', '80 derajat Celsius'] },
  { k: 'sains', t: 'Satelit alami Bumi adalah...', j: ['Bulan', 'Phobos', 'Titan', 'Europa'] },
  { k: 'sains', t: 'Proses tumbuhan membuat makanan dengan bantuan cahaya matahari disebut...', j: ['Fotosintesis', 'Respirasi', 'Transpirasi', 'Fermentasi'] },
  { k: 'sains', t: 'Pelangi terdiri dari berapa warna utama (mejikuhibiniu)?', j: ['7', '5', '6', '9'] },
  { k: 'sains', t: 'Hewan yang bernapas dengan insang adalah...', j: ['Ikan', 'Katak dewasa', 'Paus', 'Kura-kura'] },
  // ---------- Umum ----------
  { k: 'umum', t: 'Ibu kota Australia adalah...', j: ['Canberra', 'Sydney', 'Melbourne', 'Perth'] },
  { k: 'umum', t: 'Ibu kota Brasil adalah...', j: ['Brasília', 'Rio de Janeiro', 'São Paulo', 'Buenos Aires'] },
  { k: 'umum', t: 'Ibu kota Korea Selatan adalah...', j: ['Seoul', 'Busan', 'Pyongyang', 'Incheon'] },
  { k: 'umum', t: 'Ibu kota Thailand adalah...', j: ['Bangkok', 'Hanoi', 'Manila', 'Phnom Penh'] },
  { k: 'umum', t: 'Negara terkecil di dunia adalah...', j: ['Vatikan', 'Monako', 'San Marino', 'Liechtenstein'] },
  { k: 'umum', t: 'Gunung tertinggi di dunia adalah...', j: ['Everest', 'K2', 'Kilimanjaro', 'Fuji'] },
  { k: 'umum', t: 'Benua terluas di dunia adalah...', j: ['Asia', 'Afrika', 'Amerika Utara', 'Eropa'] },
  { k: 'umum', t: 'Samudra terluas di dunia adalah...', j: ['Samudra Pasifik', 'Samudra Atlantik', 'Samudra Hindia', 'Samudra Arktik'] },
  { k: 'umum', t: 'Menara Eiffel terletak di kota...', j: ['Paris', 'London', 'Roma', 'Berlin'] },
  { k: 'umum', t: 'Piramida Giza yang terkenal berada di negara...', j: ['Mesir', 'Meksiko', 'Sudan', 'Yordania'] },
  { k: 'umum', t: 'Mata uang resmi Jepang adalah...', j: ['Yen', 'Won', 'Yuan', 'Baht'] },
  { k: 'umum', t: 'Penemu telepon yang paling dikenal adalah...', j: ['Alexander Graham Bell', 'Thomas Edison', 'Nikola Tesla', 'Guglielmo Marconi'] },
  { k: 'umum', t: 'Perang Dunia II berakhir pada tahun...', j: ['1945', '1939', '1918', '1950'] },
  { k: 'umum', t: 'Hasil dari 12 x 12 adalah...', j: ['144', '124', '132', '154'] },
  { k: 'umum', t: 'Akar kuadrat dari 169 adalah...', j: ['13', '12', '14', '17'] },
  { k: 'umum', t: 'Berapa 15% dari 200?', j: ['30', '15', '20', '45'] },
  { k: 'umum', t: 'Jika warna biru dicampur dengan kuning, hasilnya adalah...', j: ['Hijau', 'Ungu', 'Oranye', 'Cokelat'] },
  { k: 'umum', t: 'Berapa lama waktu normal satu pertandingan sepak bola (tanpa tambahan waktu)?', j: ['90 menit', '60 menit', '80 menit', '120 menit'] },
  { k: 'umum', t: 'Piala Thomas adalah kejuaraan dunia untuk cabang olahraga...', j: ['Bulu tangkis', 'Tenis', 'Voli', 'Tenis meja'] },
  { k: 'umum', t: 'Juara Piala Dunia FIFA 2022 adalah...', j: ['Argentina', 'Prancis', 'Brasil', 'Kroasia'] },
  { k: 'umum', t: 'Penulisan baku untuk tempat menjual obat adalah...', j: ['Apotek', 'Apotik', 'Apoteck', 'Appotek'] },
  { k: 'umum', t: 'Penulisan baku untuk kemungkinan akibat buruk adalah...', j: ['Risiko', 'Resiko', 'Risyko', 'Riziko'] },
  { k: 'umum', t: 'Lawan kata dari "rajin" adalah...', j: ['Malas', 'Giat', 'Tekun', 'Cermat'] },
  { k: 'umum', t: 'Hewan yang dijuluki raja hutan adalah...', j: ['Singa', 'Harimau', 'Gajah', 'Beruang'] },
  // ---------- Game & teknologi ----------
  { k: 'game', t: 'Game Minecraft dikembangkan oleh studio...', j: ['Mojang', 'Valve', 'Epic Games', 'Riot Games'] },
  { k: 'game', t: 'Bahan yang dipakai untuk membuat portal Nether di Minecraft adalah...', j: ['Obsidian', 'Batu bata', 'Besi', 'Berlian'] },
  { k: 'game', t: 'Di Minecraft, mob hijau yang meledak kalau mendekati pemain disebut...', j: ['Creeper', 'Zombie', 'Skeleton', 'Enderman'] },
  { k: 'game', t: 'PUBG adalah singkatan dari...', j: ["PlayerUnknown's Battlegrounds", 'Players United Battle Ground', 'Public Battle Game', 'Pro Ultimate Battle Game'] },
  { k: 'game', t: 'GTA adalah singkatan dari...', j: ['Grand Theft Auto', 'Great Theft Adventure', 'Grand Taxi Association', 'Gangster Turf Attack'] },
  { k: 'game', t: 'Di game Among Us, pemain yang bertugas menyabotase kru disebut...', j: ['Impostor', 'Traitor', 'Killer', 'Saboteur'] },
  { k: 'game', t: 'Pokémon dengan nomor 001 di Pokédex nasional adalah...', j: ['Bulbasaur', 'Charmander', 'Pikachu', 'Squirtle'] },
  { k: 'game', t: 'Discord pertama kali dirilis pada tahun...', j: ['2015', '2012', '2017', '2019'] },
  { k: 'game', t: 'HTML adalah singkatan dari...', j: ['HyperText Markup Language', 'High Text Machine Language', 'HyperTool Multi Language', 'Home Text Markup Level'] },
  { k: 'game', t: 'WWW pada alamat website adalah singkatan dari...', j: ['World Wide Web', 'World Web Window', 'Wide World Web', 'Web World Wide'] },
  { k: 'game', t: 'CPU adalah singkatan dari...', j: ['Central Processing Unit', 'Computer Power Unit', 'Core Program Utility', 'Central Program Unit'] },
  { k: 'game', t: 'Perusahaan yang membuat konsol PlayStation adalah...', j: ['Sony', 'Microsoft', 'Nintendo', 'Sega'] },
  { k: 'game', t: 'Pendiri Microsoft bersama Paul Allen adalah...', j: ['Bill Gates', 'Steve Jobs', 'Mark Zuckerberg', 'Elon Musk'] },
];

// Satu soal siap tampil: pilihan diacak, indeks jawaban benar dicatat.
function siapkan(soal, rng) {
  const urut = kocok(soal.j.map((teks, i) => ({ teks, benar: i === 0 })), rng);
  return { t: soal.t, k: soal.k, pilihan: urut.map((x) => x.teks), benar: urut.findIndex((x) => x.benar) };
}

// Pilih satu soal acak dari kategori (soal server ikut kalau kategorinya campur atau server).
function pilih(kategori, soalServer = [], rng = require('./games').acak) {
  const server = soalServer.map((s) => ({ ...s, k: 'server' }));
  let daftar;
  if (kategori === 'server') daftar = server;
  else if (kategori && kategori !== 'campur') daftar = BAWAAN.filter((s) => s.k === kategori);
  else daftar = [...BAWAAN, ...server];
  if (!daftar.length) return null;
  return siapkan(daftar[rng(daftar.length)], rng);
}

module.exports = { KATEGORI, BAWAAN, siapkan, pilih };
