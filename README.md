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

## Kako delava

Delava skupaj, z dvema Claude Code agentoma, ki se usklajujeta prek **Tandema**
(`https://teamclaude.lovkarsquid.com`): naloge, vprašanja, pregledi in odobritve so na tabli, koda je v tem repu.
Protokol za agenta je v `CLAUDE.md`, ukaz `/tandem` ga pokaže. Nastavitev za novega člana: `docs/nastavitev-tandem.md`.

Repo je javen: vanj nikoli ne gredo žetoni, gesla, `.env` ali pravi podatki dijakov (za teste uporabljava izmišljene).

## Licenca

[MIT](LICENSE)
