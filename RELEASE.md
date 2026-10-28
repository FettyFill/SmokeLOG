# SmokeLOG beta 1.1 — attivazione

Stato al 28 ottobre 2026: il titolare ha confermato l'esecuzione dello schema SQL su Supabase. L'esito remoto non è stato verificato direttamente. La pubblicazione dei file statici e della Edge Function resta da confermare; nel codice locale `accountDeletionEnabled` è ancora `false`. Questa guida descrive anche i passaggi già eseguiti, per rendere ripetibile un rilascio.

## 1. Sincronizzazione incrementale

1. Esporta un backup dei dati che vuoi conservare.
2. Prova prima su un progetto Supabase di staging con account e dati fittizi.
3. Esegui l'intero `supabase-schema.sql` nel SQL Editor. È rieseguibile e conserva i dati. Aggiunge revisioni, indici, trigger e `smokelog_changes`; mantiene RLS e la funzione di merge compatibile.
4. Verifica con due account separati che lo storico resti isolato; con due dispositivi dello stesso account prova aggiunta, modifica, cancellazione, modalità offline e riconnessione.
5. Pubblica i file statici: `index.html`, `app.js`, `insights.js`, `style.css`, `service-worker.js`, `supabase-config.js`, `privacy.html`, `terms.html`, manifest e icone. Non caricare `node_modules`.

L'app funziona anche se il nuovo RPC non è ancora disponibile: torna alla lettura completa. Il download incrementale richiede lo schema aggiornato. Non resettare la sequenza delle revisioni e non rimuovere fisicamente singoli record dello storico durante il normale sync: le eliminazioni sono propagabili tramite `deleted_at`. L'eliminazione dell'account è un percorso separato.

Il service worker usa la cache v39. Riapri o ricarica la PWA per acquisire la nuova shell; verifica anche l'apertura offline dopo il primo caricamento online.

## 2. Eliminazione definitiva account

Il codice della Edge Function è in `supabase/functions/delete-account/`. Verifica il token direttamente con Supabase Auth, ricava da lì l'utente, rimuove le foto e infine elimina l'account con hard delete. I riferimenti `ON DELETE CASCADE` rimuovono le tabelle del diario. Gli errori dello storage interrompono il processo senza dichiarare la cancellazione riuscita; alcune foto potrebbero essere già state rimosse, quindi l'operazione è ripetibile.

1. Pubblica la funzione `delete-account` nel progetto Supabase corretto, includendo `index.ts` e `handler.mjs`.
2. Imposta il secret `SMOKELOG_ALLOWED_ORIGINS` con l'origine esatta del sito, ad esempio `https://fettyfill.github.io` (senza `/SmokeLOG`). Per staging puoi aggiungere altre origini separate da virgole.
3. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` devono esistere solo nell'ambiente server della funzione. Non inserirli nel sito statico, nei test condivisi o nel repository.
4. La funzione verifica autonomamente il JWT con `/auth/v1/user`. Se il gateway del progetto usa chiavi/signing keys non compatibili con la verifica JWT legacy, configura `verify_jwt = false` per questa sola funzione; non rimuovere la verifica Auth nel codice.
5. Con un account fittizio prova: richiesta senza token; token non valido; cancellazione con e senza foto; ripetizione dopo un errore; tentativo di passare l'ID di un altro utente (deve essere ignorato).
6. Solo dopo il collaudo imposta `accountDeletionEnabled: true` in `supabase-config.js` e pubblica il file. Fino ad allora l'app offre il contatto di supporto per la richiesta di cancellazione.

L'eliminazione rimuove i dati dal servizio attivo e dalla copia locale del browser corrente. Non può cancellare backup esportati, copie offline su altri dispositivi o copie di sicurezza del fornitore. Gli access token già emessi possono restare validi fino alla scadenza: verificare scadenza JWT e accesso allo storage dopo la cancellazione nel collaudo remoto.

## 3. Privacy e tester

- Titolare/referente: **Filippo Roggia**, **filippo.lumia0@gmail.com**.
- Piano Supabase dichiarato: **Free**. Non promettere ai tester il recupero tramite backup automatici giornalieri; quelli documentati sono previsti per i piani a pagamento. Definire anche una politica per eventuali backup amministrativi manuali.
- La località comunicata, “Piemonte”, non identifica una regione Supabase tra quelle documentate. Confermare il codice effettivo del progetto dalla dashboard prima di indicare dove risiedono i dati.
- `privacy.html` e `terms.html` sono le informazioni tecniche e condizioni della beta, visibili nell'app. Non sono una certificazione legale né un'informativa GDPR già completa.
- Prima di testare con dati personali reali, completare basi giuridiche, gestione dell'eventuale consenso esplicito, conservazione di log/backup, regione e trasferimenti, rapporti con i fornitori e procedura di esercizio dei diritti. Per ora il testo invita a usare dati fittizi.
- Nessuna monetizzazione o telemetria aggiunta. Concordare direttamente con i tester come raccogliere feedback dopo una settimana, senza richiedere il loro storico personale.

Riferimenti verificati: [regioni Supabase](https://supabase.com/docs/guides/platform/regions), [backup Supabase](https://supabase.com/docs/guides/platform/backups), [cancellazione utenti](https://supabase.com/docs/guides/auth/managing-user-data), [principi di protezione dati EDPB](https://www.edpb.europa.eu/sme/learn-the-basics/data-protection-basics_en).

## 4. Verifiche eseguite e limiti

- Test automatici: reset categorie, migrazione guest, scritture concorrenti e rollback atomico, backup vecchi, download incrementale e fallback, calcoli e obiettivi, autorizzazione e fallimenti nella cancellazione account.
- SQL eseguito due volte in PostgreSQL locale tramite PGlite: migrazione rieseguibile, RLS tra account, revisioni, cancellazioni, rifiuto del ripristino da record vecchi e cascata dopo eliminazione utente.
- Browser Chrome: mobile e desktop, registrazione, persistenza dopo reload, obiettivi, simulatore, assenza di overflow e rispetto di reduced motion.
- Da verificare in staging: richieste reali PostgREST/Edge Functions, concorrenza tra connessioni PostgreSQL, invio email, storage reale e PWA Safari/iOS. PGlite verifica SQL e RLS, ma non simula l'intera infrastruttura Supabase né la concorrenza tra server.
