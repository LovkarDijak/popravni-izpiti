# Popravni izpiti

Spletna aplikacija, v kateri se dijaki prijavijo na popravne izpite in na popravni izpit mature.
Nastaja kot raziskovalna naloga (Lovkar in Anže).

## Problem

Dijaki se danes prijavljajo na papirnate liste. Ko profesorji dobijo liste, morajo vse ročno vpisovati v računalnik:
pri tem je veliko dela in veliko napak.

## Cilj

- Dijak se prijavi prek spleta (izpit, rok, predmet).
- Profesor dobi pregleden seznam prijav brez prepisovanja (in izvoz, npr. CSV).
- Raziskovalna naloga, ki jo lahko predstaviva na maturi.

## Zagon

Potrebuješ [Node.js](https://nodejs.org/) 22.13 ali novejši (z njim pride npm in vgrajeni SQLite).

```bash
npm install   # enkrat, namesti pakete iz package-lock.json
npm start     # zažene strežnik na http://localhost:3000
npm test      # požene vse teste
npm run seed  # napolni bazo z izmišljenimi podatki za razvoj
```

Ali strežnik teče, preveriš na `http://localhost:3000/health`, ki vrne `{"ok":true}`.
Obrazec za prijavo na izpit je na `http://localhost:3000/prijava` (tja preusmeri tudi `/`).
Za poskus najprej zaženi `npm run seed`, da dobiš izmišljene predmete in roke.
Profesorji vidijo prijave na `http://localhost:3000/profesor` (geslo iz `TEACHER_PASSWORD`, uporabniško ime je poljubno)
in jih tam prenesejo v CSV, ki ga Excel odpre z dvojnim klikom (UTF-8, ločilo podpičje).
Geslo gre ob vsaki zahtevi po omrežju, zato aplikacijo zunaj lastnega računalnika poganjaj samo za HTTPS
in za `TEACHER_PASSWORD` izberi dolgo naključno geslo (vsaj 16 znakov).

Nastavitve so v okoljskih spremenljivkah. Za lokalni zagon kopiraj `.env.example` v `.env` in ga prilagodi
(`.env` ne gre v git). Spremenljivka, ki je že nastavljena v okolju, ima prednost pred `.env`.

| Spremenljivka | Privzeto | Pomen |
|---|---|---|
| `PORT` | `3000` | vrata, na katerih posluša strežnik |
| `TEACHER_PASSWORD` | (prazno) | geslo za `/profesor`; brez njega je pregled prijav zaprt |
| `DB_PATH` | `data/popravni-izpiti.sqlite` | datoteka baze SQLite, glede na mapo, iz katere zaženeš ukaz (`data/` in `*.sqlite` ne gredo v git) |

Sklad: Node.js, [Express](https://expressjs.com/), baza SQLite prek vgrajenega modula `node:sqlite`,
testi z vgrajenim `node:test` in [supertest](https://github.com/ladjs/supertest).
Node ob uporabi baze izpiše opozorilo `ExperimentalWarning: SQLite is an experimental feature`; to je pričakovano.

Podatkovni model (`src/db/`): predmet (ime, vrsta `popravni` ali `matura`), izpitni rok (predmet, datum `LLLL-MM-DD`, opis)
in prijava (rok, ime, priimek, razred, e-pošta, čas prijave). Dijak se na en rok prijavi le enkrat (prepozna se po e-pošti,
ne glede na velike in male črke). Testni in razvojni podatki so vedno izmišljeni (naslovi na `example.com`).

## Kako delava

Delava skupaj, z dvema Claude Code agentoma, ki se usklajujeta prek **Tandema**
(`https://teamclaude.lovkarsquid.com`): naloge, vprašanja, pregledi in odobritve so na tabli, koda je v tem repu.
Protokol za agenta je v `CLAUDE.md`, ukaz `/tandem` ga pokaže. Nastavitev za novega člana: `docs/nastavitev-tandem.md`.

Repo je javen: vanj nikoli ne gredo žetoni, gesla, `.env` ali pravi podatki dijakov (za teste uporabljava izmišljene).

## Licenca

[MIT](LICENSE)
