# Struttura di SmokeLOG 1.2

Il sito rimane statico, senza framework e senza dipendenze runtime aggiuntive.

| Percorso | Responsabilità |
| --- | --- |
| `src/core/` | Stato condiviso, riferimenti DOM, timeout delle richieste |
| `src/account/` | Accesso, sessione, profilo e avatar |
| `src/data/` | IndexedDB, validazione/importazione/esportazione, diario e preferenze |
| `src/sync/` | Trasferimento cloud, confronto delle revisioni, risoluzione dei conflitti |
| `src/domain/insights.js` | Calcoli puri delle statistiche e degli obiettivi |
| `src/ui/` | Schermate, grafici, modali, eventi e interazioni mobile |
| `src/styles/` | Stili ordinati per base, dashboard, navigazione, layout, consapevolezza e mobile |
| `src/bootstrap.js` | Avvio dell’app |
| `src/service-worker.js` | Cache coerente della versione e aggiornamento su richiesta |
| `supabase/schema/` | Schema di base e migrazione di affidabilità |
| `supabase/functions/` | Funzione server di cancellazione account |
| `tests/`, `e2e/` | Test di dati/SQL e flussi browser |
| `scripts/` | Build deterministica e server locale con cloud disabilitato |

`npm run build` genera `app.js`, `insights.js`, `assets/css/app.css`, `service-worker.js` e `supabase-schema.sql`. Modificare i sorgenti, non questi file generati. I manifest `src/modules.json` e `src/styles/modules.json` dichiarano l’ordine di composizione.

La separazione è incrementale: i moduli applicativi condividono ancora lo scope lessicale dello stato storico, mentre i calcoli di Consapevolezza sono autonomi. Non si tratta di una conversione completa a moduli ES. La compilazione concatena i file senza cambiare il formato dei dati o richiedere un framework. I livelli CSS mantengono l’ordine della cascata originale; le nuove regole sono nel modulo mobile.

## Dati e sincronizzazione

Registrazioni, acquisti e categorie conservano lo stesso database IndexedDB. Le nuove quantità/unità/contesto/intensità sono nel campo `details`; una registrazione rapida senza dettagli mantiene il significato di una voce, non di una dose equivalente. I totali dell’interfaccia contano registrazioni; la quantità è visibile nel dettaglio e nel CSV.

La RPC v2 verifica `base_revision` prima di scrivere e assegna la data di aggiornamento sul server. Un conflitto lascia intatte le modifiche locali. Il pulsante “Risolvi conflitti” permette di conservare il dispositivo o il cloud per le sole voci in conflitto. Il controllo viene ripetuto dal server anche dopo la scelta, per proteggere da modifiche concorrenti.

Percorso, giorni confermati, voglie, promemoria e obiettivi sono un documento separato per proprietario, persistito in localStorage e sincronizzato nella tabella privata `smokelog_wellness`. La revisione del documento impedisce sovrascritture silenziose. In caso di conflitto l’utente sceglie una versione in Consapevolezza; non viene simulata una fusione sicura di modifiche incompatibili. Il primo account senza diario cloud riceve il diario ospite; la copia ospite viene conservata. Un diario account esistente non viene sostituito automaticamente dal diario ospite.

Il backup JSON v4 include i dettagli e il diario. Legge anche le versioni 1–3. Importare un v4 in un archivio con preferenze già modificate conserva le preferenze correnti e unisce giorni confermati e voglie per ID; in un archivio nuovo ripristina il documento completo. La validazione precede la scrittura. L’archivio IndexedDB usa transazioni; il documento localStorage viene salvato separatamente, quindi le due scritture non costituiscono una singola transazione.

## Statistiche e aggiornamenti

Le variazioni percentuali richiedono tutti i 14 giorni confrontati confermati. Un giorno senza registrazioni non significa zero consumi finché l’utente non lo conferma. La media e il simulatore utilizzano solo gli acquisti dei giorni confermati nella finestra di 28 giorni. Le fasce tutte uguali non producono un falso picco.

Il service worker precachea l’intera shell e serve una versione coerente anche su rete lenta. La nuova versione attende il comando “Aggiornamento disponibile · Ricarica”. Il nome cache deriva dal contenuto della build. Risorse mancanti non ricevono HTML al posto di JavaScript/CSS. Le richieste cloud scadono dopo 15 secondi; la sincronizzazione si riprova tramite il pulsante, al ritorno nell’app o al ritorno della rete, senza loop di tentativi illimitati.

Il promemoria scelto dall’utente compare solo nell’app aperta. Push in background, widget, comunità e traguardi restano evoluzioni successive, come indicato nell’analisi originale.
