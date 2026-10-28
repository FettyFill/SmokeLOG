# SmokeLOG — report sullo stato attuale

Data: 28 ottobre 2026. Versione: beta 1.1 (1.1.0). Responsabile: Filippo Roggia.

## Valutazione sintetica

Il progetto dispone di un nucleo funzionale per una beta privata: registrazione locale, account, sync, backup e statistiche con obiettivi. Le correzioni recenti affrontano reset delle categorie, scritture concorrenti e importazione di dati vecchi. La nuova area Consapevolezza collega gli acquisti a confronti e scenari di risparmio.

È indicato procedere con collaudo controllato e dati fittizi. Non è ancora documentata una validazione completa del servizio pubblicato, né sono completati i prerequisiti per la distribuzione pubblica con dati personali reali.

## Perimetro e prove

Questo report deriva dalla lettura del codice locale, dai test automatici e dalle informazioni comunicate dal titolare. Non è un penetration test, una certificazione di accessibilità o un parere legale. Non è stato effettuato un audit autenticato del progetto Supabase né un confronto tra file locali e sito pubblico.

| Elemento | Stato ed evidenza |
| --- | --- |
| Codice e interfaccia beta 1.1 | Implementati localmente |
| Schema SQL remoto | Esecuzione confermata dal titolare; esito non verificato direttamente |
| Configurazione Supabase | URL del progetto presente nel client; piano Free dichiarato |
| Regione database | Da confermare tramite codice della regione nella dashboard |
| File sul sito pubblico | Pubblicazione/versione non confermata |
| Sync incrementale | Implementazione client e SQL disponibili; test locali passati, collaudo remoto pendente |
| Cancellazione account | Handler implementato e testato con risposte simulate; flag client ancora `false` |
| Privacy e condizioni | Pagine presenti con contatti del titolare; contenuti della beta da completare |
| CI | Workflow definito; esecuzione su GitHub non verificata in questa sessione |

## Funzioni e miglioramenti presenti

- Diario consumi/acquisti, storico filtrabile e categorie personalizzabili.
- Accesso, sessione persistente, nickname e foto profilo.
- Commit locale atomico, verifica delle scritture concorrenti e migrazione guest corretta.
- Upload delle differenze e download per revisioni server, con fallback per lo schema precedente.
- Importazione con timestamp originali e protezione dei record più recenti.
- Spesa mensile, media giornaliera, confronti su settimane complete e distribuzione dell'attività.
- Obiettivi locali per archivio e simulatore di risparmio con metodo visibile.
- Layout mobile/desktop, transizioni con reduced motion, testi non selezionabili fuori dai campi e icona impostazioni ridisegnata.
- Supporto visibile, documentazione del rilascio e test automatizzati.

## Verifiche disponibili

La suite applicativa comprende 19 test: categorie e sync, concorrenza e rollback IndexedDB, backup, download incrementale, autorizzazione/fallimenti della cancellazione, calcoli e migrazione SQL. La suite browser comprende due scenari equivalenti su viewport mobile e desktop, con verifiche anche a 320 px, reload e offline.

Nell'ultima revisione sono stati rieseguiti con esito positivo i controlli sintattici e i 19 test applicativi. Una verifica mirata in Chrome a 375 px ha confermato testi non selezionabili, selezione funzionante negli input e assenza di overflow; l'icona è stata controllata tramite screenshot. I due scenari browser completi risultavano superati nel lavoro precedente. I risultati delle esecuzioni future saranno consultabili in CI. I test usano fake-indexeddb, PostgreSQL tramite PGlite e Chrome: non attestano il comportamento di Safari/iOS o dell'infrastruttura Supabase reale.

## Limiti attuali

| Area | Limite | Effetto pratico |
| --- | --- | --- |
| Cloud | Deploy e flussi reali non verificati dall'agente | Va effettuato un collaudo con account di prova prima di affidarsi al servizio |
| Obiettivi | Persistenza solo locale, fuori dal backup JSON | Non seguono l'utente su un altro dispositivo |
| Dimensione archivio | Cache e letture locali ancora complete | Non sono disponibili benchmark che garantiscano fluidità con archivi molto grandi |
| Conflitti | Risoluzione automatica senza storico versioni | Non esiste ripristino manuale di versioni precedenti dello stesso record |
| Cancellazione storico | Record contrassegnati, non rimossi fisicamente | Non equivale a eliminazione definitiva dei dati |
| Account | Autoeliminazione disabilitata nel client | Durante la beta la richiesta passa dal supporto |
| Privacy | Regione, conservazione, basi giuridiche e gestione degli eventuali consensi da completare | Non presentare la beta come già pronta per dati personali reali |
| Qualità | Nessun audit completo di accessibilità, sicurezza o carico | I test automatici coprono casi definiti, non ogni comportamento possibile |

## Priorità successive

1. Verificare che il sito pubblicato serva i file aggiornati e che la PWA riceva la cache v39.
2. Collaudare sync con due dispositivi e isolamento con due account, inclusi offline, riconnessione e modifiche concorrenti.
3. Pubblicare e collaudare `delete-account`; abilitare il flag solo dopo esito positivo.
4. Confermare regione e configurazione dei fornitori, completare informativa e condizioni prima di dati reali.
5. Eseguire il test su Safari/iPhone e con un archivio sintetico consistente, misurando tempi e richieste.
6. Raccogliere feedback da 5–10 tester: facilità di registrazione, comprensione delle statistiche e uso dopo una settimana. La ricerca non è ancora stata eseguita.

Non è necessario introdurre ora pagamenti, altri framework o ulteriori servizi per completare questi passaggi. Le future decisioni di prodotto possono basarsi sui risultati del collaudo.

## Documenti mantenuti

[README](../README.md) come ingresso al progetto; [documentazione ufficiale](PROJECT.md) come riferimento funzionale/tecnico; questo report come fotografia datata; [guida tester](TESTING.md) per la verifica; [RELEASE](../RELEASE.md) per l'attivazione; [CHANGELOG](../CHANGELOG.md) per la storia delle modifiche. Privacy e termini restano nelle pagine HTML visibili agli utenti.

Non vengono aggiunti contratti, certificazioni o una licenza software scelta senza indicazioni del titolare. L'eventuale licenza e le condizioni commerciali vanno definite prima di una distribuzione pubblica che le richieda.
