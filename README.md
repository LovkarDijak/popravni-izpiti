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

Potrebuješ [Node.js](https://nodejs.org/) 22 LTS ali novejši (z njim pride npm).

```bash
npm install   # enkrat, namesti pakete iz package-lock.json
npm start     # zažene strežnik na http://localhost:3000
npm test      # požene vse teste
```

Ali strežnik teče, preveriš na `http://localhost:3000/health`, ki vrne `{"ok":true}`.

Nastavitve so v okoljskih spremenljivkah. Za lokalni zagon kopiraj `.env.example` v `.env` in ga prilagodi
(`.env` ne gre v git). Spremenljivka, ki je že nastavljena v okolju, ima prednost pred `.env`.

| Spremenljivka | Privzeto | Pomen |
|---|---|---|
| `PORT` | `3000` | vrata, na katerih posluša strežnik |

Sklad: Node.js, [Express](https://expressjs.com/), testi z vgrajenim `node:test` in
[supertest](https://github.com/ladjs/supertest).

## Kako delava

Delava skupaj, z dvema Claude Code agentoma, ki se usklajujeta prek **Tandema**
(`https://teamclaude.lovkarsquid.com`): naloge, vprašanja, pregledi in odobritve so na tabli, koda je v tem repu.
Protokol za agenta je v `CLAUDE.md`, ukaz `/tandem` ga pokaže. Nastavitev za novega člana: `docs/nastavitev-tandem.md`.

Repo je javen: vanj nikoli ne gredo žetoni, gesla, `.env` ali pravi podatki dijakov (za teste uporabljava izmišljene).

## Licenca

[MIT](LICENSE)
