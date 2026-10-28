# SmokeLOG

**Beta privata 1.1 · documentazione aggiornata al 28 ottobre 2026**

SmokeLOG è un diario personale per registrare consumi e acquisti, osservare le abitudini e impostare obiettivi di spesa. È una Progressive Web App realizzata con HTML, CSS e JavaScript senza framework: funziona in locale e può sincronizzare lo storico con un account Supabase.

**Titolare e referente:** Filippo Roggia · [filippo.lumia0@gmail.com](mailto:filippo.lumia0@gmail.com).

## Stato del progetto

La versione locale comprende sincronizzazione incrementale, backup con gestione dei conflitti, statistiche, obiettivi e simulatore di risparmio. Il titolare ha confermato l'esecuzione dello schema SQL su Supabase; il risultato remoto e la versione effettivamente pubblicata non sono stati verificati direttamente. La cancellazione automatica dell'account è implementata ma disabilitata finché la funzione server non viene pubblicata e collaudata.

La beta è destinata al collaudo con dati fittizi. Informativa, configurazione dei fornitori e condizioni per l'uso di dati personali reali richiedono ancora completamento. Il progetto non è presentato come già pronto alla commercializzazione.

## Funzioni

| Area | Disponibilità |
| --- | --- |
| Oggi | Registrazione rapida dei consumi e degli acquisti; totale giornaliero |
| Statistiche | Spese, quantità, grafici e dettagli per categoria e periodo |
| Consapevolezza | Spesa mensile, confronti settimanali, distribuzione oraria, budget, limite giornaliero e risparmio stimato |
| Storico | Filtri, modifica data/ora e cancellazione delle registrazioni |
| Impostazioni | Categorie personalizzabili, profilo, archivio, backup, privacy e supporto |
| Account | Accesso email/password, recupero sessione e sincronizzazione tra dispositivi |
| Offline | Archivio locale e interfaccia disponibile dopo il primo caricamento online |

Gli obiettivi e la percentuale del simulatore restano su questo browser, separati per archivio; non sono sincronizzati né inclusi nel backup dello storico. I confronti usano giorni completi e il risparmio è una simulazione basata sugli acquisti, non una previsione garantita.

## Avvio locale

Prerequisiti: Node.js e npm; la CI usa Node.js 22. Per i test UI locali occorre Chrome installato.

```sh
npm ci
npm run preview
```

Apri [l'anteprima](http://127.0.0.1:49173). Questo server disabilita Supabase e serve soltanto i file statici dell'app: è adatto a provare interfaccia e archivio locale senza accedere ad account reali. Non usare `file://` per verificare PWA e service worker.

Per provare un account, usa invece un server statico con la configurazione Supabase prevista per lo staging e autorizza il relativo redirect nel progetto. L'anteprima integrata non è un test del cloud.

## Verifiche

```sh
npm run check
npm test
npm run test:ui
```

Chiudi l'anteprima con Ctrl+C prima di avviare i test UI: utilizzano la stessa porta. La pipeline [GitHub Actions](.github/workflows/check.yml) esegue controlli sintattici, test applicativi, SQL e browser; non effettua il deploy. I test non richiedono credenziali Supabase reali. Vedi la [guida di collaudo](docs/TESTING.md) per copertura e prove manuali.

## Account e pubblicazione

Il progetto configurato è `giwispikyzddqolrqwfz`; il piano Free è stato dichiarato dal titolare. La regione effettiva del database resta da confermare dalla dashboard.

1. Configura URL e chiave pubblica in `supabase-config.js`. Non inserire una chiave amministrativa nel client.
2. Esegui `supabase-schema.sql` nel SQL Editor del progetto corretto. Il titolare ha dichiarato di aver completato questo passaggio il 28 ottobre 2026.
3. Configura Site URL, redirect e invio email per l'ambiente di destinazione.
4. Pubblica i file statici elencati in [RELEASE.md](RELEASE.md); lo script SQL si esegue sul database, non deve essere servito al browser.
5. Per l'eliminazione automatica dell'account, pubblica e collauda separatamente la Edge Function prima di abilitare il relativo flag.

La procedura dettagliata e i controlli prima del rilascio sono in [RELEASE.md](RELEASE.md). Dopo la pubblicazione, verifica aggiornamento della PWA, accesso, sincronizzazione e modalità offline su dispositivi reali.

## Dati e riservatezza

- Consumi, acquisti e categorie sono conservati in IndexedDB; con un account vengono sincronizzati su Supabase.
- L'accesso usa policy RLS per account. Non è presente cifratura end-to-end.
- Uscire dall'account non cancella i dati cloud o la copia locale dell'account.
- La cancellazione dello storico mantiene record contrassegnati come eliminati per sincronizzare la rimozione. Non equivale alla cancellazione definitiva dell'account.
- JSON è il formato di backup ripristinabile; CSV è un'esportazione per consultazione.
- Nessun analytics aggiunto. La sessione viene conservata nel browser.

Le informazioni visibili agli utenti sono in [privacy.html](privacy.html) e [terms.html](terms.html). Il loro stato e le attività ancora necessarie sono descritti nel report.

## Documentazione del progetto

| Documento | A cosa serve |
| --- | --- |
| [Documentazione ufficiale](docs/PROJECT.md) | Funzionamento, architettura, dati, calcoli e manutenzione |
| [Report sullo stato attuale](docs/STATUS.md) | Evidenze, limiti, stato del rilascio e priorità |
| [Guida per tester e verifiche](docs/TESTING.md) | Scenari ripetibili e segnalazione dei problemi |
| [Guida al rilascio](RELEASE.md) | Attivazione SQL, pubblicazione e cancellazione account |
| [Registro delle modifiche](CHANGELOG.md) | Modifiche della beta 1.1 |

## File principali

### Cosa caricare su GitHub

Non caricare `node_modules/`: è già esclusa da `.gitignore` e viene ricreata con `npm ci`. Nel repository conserva invece `package.json` e `package-lock.json`, insieme a codice, test, documentazione e workflow. Per pubblicare il sito statico segui l'elenco di `RELEASE.md`: il browser non richiede le dipendenze di sviluppo. Se carichi i file dall'interfaccia web di GitHub, escludi manualmente `node_modules/` dalla selezione: il caricamento web non applica automaticamente il tuo `.gitignore`.

`index.html` contiene l'interfaccia; `style.css` lo stile; `app.js` archivio e flussi applicativi; `insights.js` i calcoli di Consapevolezza; `service-worker.js` la cache offline; `supabase-schema.sql` il database; `supabase/functions/delete-account/` la cancellazione account. Le dipendenze npm sono strumenti di sviluppo e test, non dipendenze runtime del sito.

Per assistenza indica dispositivo, browser, passaggi e risultato atteso. Non inviare password, token o backup personali. Per i problemi di email consulta la [guida SMTP Supabase](https://supabase.com/docs/guides/auth/auth-smtp): una richiesta accettata dal servizio non prova la consegna del messaggio.
