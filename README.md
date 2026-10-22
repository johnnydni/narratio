# narratio

Schreibwerkzeug für Spiele-Narrative: Manuskript, Dialogbäume mit Varianten und Lore in **einem** Datenmodell. Local-first, live synchronisiert zwischen Fenstern, Export nach Unreal.

> Stand: **P0 (Prototyp)** aus dem Lastenheft. Nutzbar zum Ausprobieren, noch nicht für das echte Projekt.

## Was schon geht

- **Schreiben:** Rich-Text-Editor (TipTap) mit Binder, Status, Synopse, Wortziel und Fokusmodus. `@` fügt Verweise auf Figuren, Orte, Items und Quests ein; umbenennen wirkt überall sofort.
- **Dialoge:** Node-Graph (React Flow) mit Zeilen, Auswahl, Effekt, Ende und Sprung. Eine Zeile hat **Varianten** mit Bedingungen über Perks, Skills, Questphasen, Inventar, Flags und Ergebnisse anderer Dialoge, plus Pflicht-Fallback.
- **Vorschau mit Spielstand:** zeigt im Graph und im Inspector, welche Variante greift und warum.
- **Weltzustand:** zentrale Variablen mit Export-Schlüsseln, Verwendungsnachweis, Spielstände.
- **Lore:** Einträge mit eigenen Feldern, stabiler Export-ID und „Verwendet in“.
- **Prüfung und Export:** fehlende Fallbacks, tote Verweise, unbekannte Variablen, Sackgassen, unerreichbare Nodes; Export als Unreal-JSON (Bedingungen als Ausdrucksbaum) und Lore als CSV für Data Tables.
- **Sicherung:** offenes ZIP, lesbar ohne narratio (Szenen und Lore als Markdown, vollständiger Stand als `narratio.json`). Automatisch alle 15 Minuten im Browser, 30 Tage aufbewahrt; in Chrome und Edge zusätzlich täglich in einen frei wählbaren Ordner. Wiederherstellen ersetzt den Stand und sichert vorher den alten. Alte `.narratio`-Dateien lassen sich weiter einlesen.
- **Eintauchen:** wer zügig schreibt, dem blendet die Oberfläche aus und eine Klangwelt ein (Regen, Kaminfeuer, Wind, Klangteppich, Nacht), dazu Schreibmaschinen-Anschläge. Alles per Web Audio erzeugt, ohne Dateien. Mausbewegung oder Esc holt die Oberfläche zurück.
- **Speicherung und Sync:** Yjs (CRDT) in IndexedDB, live zwischen Fenstern per BroadcastChannel. Gleichzeitiges Schreiben in zwei Fenstern wird ohne Verlust zusammengeführt. narratio fordert dauerhaften Speicher an und warnt in der Kopfzeile, wenn der Browser ablehnt.
- **Schema-Migrationen:** versioniert und idempotent (`src/store/migrate.ts`); vor jeder Migration entsteht automatisch eine Sicherung. Ein Projekt aus einer neueren Version wird nicht angefasst.

## Was noch fehlt (nächste Phasen)

- Sync zwischen Geräten über einen Server (P3), bisher nur zwischen Fenstern desselben Browsers
- Bilder, PDFs, Moodboard und Medien am Dialog (P1/P3)
- Test-Durchlauf eines Dialogs, Skriptansicht, Corkboard, Outliner
- Unreal-Runtime bzw. Plugin, das das Exportformat auswertet
- Eigene Audiodateien als Klangwelt

## Starten

Voraussetzung: **Node.js 22.12 oder neuer** (`node -v`). Ältere Versionen brechen beim Start mit `does not provide an export named 'styleText'` ab. Unter Windows: aktuelle LTS von nodejs.org installieren oder `winget install OpenJS.NodeJS.LTS`, danach ein neues Terminal öffnen.

```bash
npm install
npm run dev        # Entwicklung, http://localhost:5173
npm test           # Unit-Tests (Modell, Export, Sync)
npm run e2e        # Browser-Tests inkl. Zwei-Fenster-Sync (Playwright)
npm run build      # Produktionsbuild nach dist/
```

Beim ersten Start wird das Beispielprojekt „Aschenstadt“ angelegt.

## Aufbau

```
src/model/    reine Logik ohne UI: Typen, Bedingungen, Varianten, Prüfung, Unreal-Export
src/store/    Yjs-Abbildung, Sitzung (IndexedDB), Fenster-Sync, Beispielprojekt
src/editor/   TipTap-Erweiterungen (Lore-Verweis, @-Auswahl, Fokus), Mini-Editor für Dialogtexte
src/audio/    Web-Audio-Klangwelten und Schreibmaschine
src/ui/       React-Oberfläche
e2e/          Playwright-Tests
```

Bewusste Entscheidungen:

- **Bedingungen sind ein strukturierter Baum, kein Freitext.** Nur so kann Unreal sie ohne Übersetzung auswerten und narratio sie prüfen.
- **Verweise laufen über IDs, nie über Namen.** Umbenennen bricht nichts; die Export-ID bleibt stabil.
- **Langtext wird zeichengenau gemergt** (CRDT), kurze Felder wie Variantentexte nach „letzte Änderung gewinnt“. Für einen Nutzer auf mehreren Geräten reicht das.
- **Editor und Graph laden erst bei Bedarf.** Das Start-Paket liegt bei rund 90 KB komprimiert.
- **Schriften sind lokal gebündelt**, keine Anfragen an Dritte.
