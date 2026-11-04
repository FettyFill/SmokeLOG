# Aggiornamento alla versione 1.2

1. Conservare un backup JSON dello storico e una copia della versione pubblicata.
2. Eseguire `npm run build` nella cartella del progetto.
3. Eseguire **l’intero `supabase-schema.sql` generato** nel SQL Editor del proprio progetto Supabase, prima di pubblicare il nuovo frontend. La migrazione è ripetibile e conserva le tabelle e i dati esistenti.
4. Pubblicare insieme `index.html`, `app.js`, `insights.js`, `service-worker.js`, `supabase-config.js`, `manifest.webmanifest`, `privacy.html`, `terms.html`, `assets/` e `icons/`. Non pubblicare `node_modules`, test, sorgenti SQL o risultati dei test.
5. Riaprire la PWA e usare il pulsante di aggiornamento quando compare. Se il vecchio worker usa aggiornamenti immediati, il primo passaggio dalla versione 1.1 dipende dal suo comportamento precedente; dalla 1.2 gli aggiornamenti sono espliciti.
6. Verificare un account di prova su due dispositivi: aggiunta offline, sincronizzazione, modifica concorrente, scelta della versione in conflitto, obiettivi e diario.

Le nuove scritture cloud richiedono `merge_smokelog_data_v2`, la colonna `details` e `smokelog_wellness`. Se manca la migrazione i dati locali rimangono disponibili e viene segnalato l’errore cloud; non si effettua un downgrade silenzioso che perderebbe i nuovi dettagli.

La preview locale disabilita Supabase intenzionalmente. I test SQL usano PostgreSQL incorporato (PGlite), account e dati sintetici. Non dimostrano che la migrazione sia già stata eseguita nel progetto remoto. La pubblicazione e la migrazione remota non sono state effettuate in questa lavorazione.

Verificare ancora su iPhone/Safari fisico: tastiera, installazione PWA, sospensione prolungata, ripristino e cambio di giorno. Il font minimo dei campi è 16 px e le modali sono scorrevoli, ma la verifica desktop con viewport mobile non sostituisce quella su dispositivo.
