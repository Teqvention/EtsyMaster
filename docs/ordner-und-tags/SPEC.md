# Ordner, Tags, Shop-Navigation — SPEC

**Stand:** 13.10.2026. Was diese Runde baut, wie es gemeint ist und wie es geprüft wurde. Die automatische
Mockup-Erkennung (Ecken, Sets, Hände, „In front of poster“) steht in [`docs/mockup-erkennung.md`](../mockup-erkennung.md).

## 1 · Anforderungen

### Saved: Ordner in Ordnern

1. **Ordner lassen sich beliebig verschachteln** (Primary → Secondary → tiefer, bis 6 Ebenen). Ein Ordner heißt nach
   seinem Pfad (`robin/Cats/Black`), angezeigt als „robin › Cats › Black“. Ein Listing liegt weiterhin in genau einem
   Ordner (`src/lib/saved/folders.ts`).
2. **Seitenleiste als Baum:** Ordner mit Unterordnern haben ein Doppelordner-Icon, das beim Hover zum Pfeil wird
   (auf-/zuklappen, wie Notion). Eine Linie zeigt die Ebene. Welche Ordner offen sind, merkt sich das Gerät; der
   geöffnete Ordner und seine Eltern sind immer offen. Zahlen zählen den Ordner samt allem darin.
3. **Unterordner anlegen:** „+“ in der Zeile (Hover), Rechtsklick → „New folder inside“, oder „New folder“ in den Chips
   des geöffneten Ordners. Im „Move to…“-Picker: „Create „x“ in robin“ oder `a/b` tippen.
4. **Wie bei den Shops:** unter dem Titel eine Chip-Reihe pro Ebene (`↳ All robin · Cats · Dogs · Not in a subfolder`),
   die gewählte gedrückt; so geht es immer tiefer und per Breadcrumb im Titel zurück.
5. **Ein Ordner zeigt alles in ihm und in seinen Unterordnern**, gruppiert mit Überschrift je Unterordner („Cats ›
   Black“, „robin itself“). „Not in a subfolder“ (`&direct`) zeigt nur, was direkt im Ordner liegt.
6. **Umbenennen** (Doppelklick oder Rechtsklick → Rename), **Verschieben** (Rechtsklick → Move to, oder Ordner auf
   einen anderen ziehen, auf „Folders“ ziehen = nach oben), **Löschen** (nur leere Ordner). Verschieben hat Undo.
   Poster-Sets der Listings ziehen mit um (Generation-Seite folgt).
7. **Drag & Drop von Listings:** Kachel (oder die ganze Auswahl, dann mit „3 listings“-Badge) auf einen Ordner in der
   Seitenleiste ziehen = dorthin verschieben, mit Undo. Über einem zugeklappten Ordner kurz verweilen klappt ihn auf.

### Saved: Text-Bug

8. **Titel einer Kachel können nie mehr über die Nachbarkachel laufen.** Der Textblock ist auf die Kachel begrenzt
   (`overflow-hidden`, `contain: paint`, volle Breite für Titel- und Preiszeile), der volle Titel steht im Tooltip.

### Tags: mehrere Primary-Tags (Shops und Mockups)

9. **Ein Shop oder Mockup kann mehrere Primary-Tags tragen**, jeder mit eigenen Secondary-Tags
   (`src/lib/tags.ts`). Der Picker (`components/tags/tag-picker.tsx`) zeigt Primary-Tags als Checkliste (bereits
   vergebene oben), darunter je gemeinsamem Primary-Tag einen Secondary-Block. Für mehrere Dinge zugleich zeigt „–“,
   dass nur manche den Tag tragen.
10. **Filter wie bei den Shops** (`components/tags/tag-filter-chips.tsx`): Chip-Reihe der Primary-Tags (All, Tags,
    Untagged), darunter ↳ die Secondary-Tags des gewählten (All X, Tags, No secondary tag). Gleiche Komponente auf
    Shops, Mockups und im Chain-Picker.
11. **Mockups bekommen Tags wie Shops:** Tag-Knopf auf der Karte (Hover), Rechtsklick → „Tags…“, „Select“ → mehrere
    wählen → „Tag…“. Die Karte zeigt ihre Tags unter dem Namen. Export heißt „Export City › Cartoon“. Neue Mockups auf
    einer gefilterten Seite bekommen den Primary-Tag.

### Shops

12. **Zurück zur Shop-Liste:** auf einem Shop oben links „← Shops“ mit den Filtern, mit denen man die Liste verlassen hat
    (Tags, Liked, Land, Analyse, Sales, Sortierung, Suchtext; z. B. „← Shops citys · “a”“). War die Liste die Seite
    davor, ist es Browser-Zurück (Scrollposition bleibt), sonst öffnet sie neu mit den gemerkten Filtern.
13. **„Hide filed“ in der Shop-Galerie:** blendet alle Listings aus, die schon in einem Saved-Ordner liegen, damit nur
    neue Fotos zu sehen sind. Zählt, wie viele ausgeblendet sind; Ränge bleiben; das Gerät merkt sich die Einstellung.

## 2 · Annahmen

- **Gemeinsame Datenbank mit älteren Servern:** Mehrere Tags werden als volle Liste (`tags`) plus erstem Primary-Tag
  im alten Feld gespeichert (Shop: `tag`, Mockup: `category`). Ältere Server sehen und ändern so weiter den ersten Tag;
  wo beide auseinanderlaufen, gewinnt das alte Feld für den ersten (`joinTags`).
- **Ordnerpfade mit „/“:** Ältere Server sehen „robin/Cats“ als flachen Ordnernamen — funktioniert, nur ohne Baum.
- **Ordner sind exklusiv, Tags nicht:** Ein Listing liegt in einem Ordner (wie bisher, „Move to“ verschiebt); mehrere
  Primary-Tags gibt es für Shops und Mockups.
- **Mockup-Kategorie = Primary-Tag:** Die bestehenden Kategorien (dopamin, Clean, Funky) sind jetzt Primary-Tags; die
  Steal-Dialoge wählen weiter einen davon für neue Mockups.
- **Der Editor ändert keine Tags:** `saveScene` behält Kategorie und Tags aus der Datenbank, damit ein offener Editor
  keine Tags überschreibt, die auf dem Grid gesetzt wurden.
- **Upload-Entwürfe** behalten den Ordnernamen, den sie beim Anlegen hatten (Umbenennen ändert nur Saved und Poster-Sets).

## 3 · Geprüft (Browser, echte Daten, danach zurückgesetzt)

- Shops: „← Shops“ von `?tag=citys` + Suche „a“ → Shop → Tab-Wechsel → zurück: gleiche URL; ebenso nach einem zweiten
  Shop aus der Suche.
- Galerie terracottanoon: „Hide filed 57“ → 36 Kacheln ohne Ordner-Badge, Ränge 2, 3, 4, 6 … bleiben; aus → alles da.
- Shop-Tags: zwei Primary-Tags mit je einem Secondary an terracottanoon, Filter `?tag=zz-test-b` zeigt den Shop,
  „Remove tags“ → wieder ohne Tags.
- Mockups: „Clean“ zusätzlich zu „dopamin“ an einer Karte, Secondary „zz-sub“, Filter dopamin › zz-sub → 1 Karte,
  danach zurückgesetzt (Dokument wieder nur „dopamin“). Select-Modus: Klicks wählen statt den Editor zu öffnen,
  „Tag…“-Dialog für die Auswahl.
- Saved: Unterordner in „wtf“ angelegt, Listing per Drag & Drop hinein, per Doppelklick umbenannt, Ordner nach oben
  gezogen, zurück in „wtf“ gezogen, Listing zurück, leeren Ordner gelöscht — jeder Schritt per API nachgeprüft, Ende
  wie Anfang. Baum in Dark und Light angesehen.
- `tsc` und `eslint` grün.
