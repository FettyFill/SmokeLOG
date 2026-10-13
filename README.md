# SmokeLog — diario personale

Una Progressive Web App (PWA) per registrare separatamente sigarette e canne. L'interfaccia è realizzata con HTML, CSS e JavaScript senza framework. Con la configurazione Supabase, account e database online permettono di ritrovare lo stesso storico da browser e dispositivi diversi.

## Funzionalità

- Registrazione di sigarette e canne con data e ora.
- Contatori per oggi, ultimi 7 giorni, mese corrente e anno corrente.
- Grafico riepilogativo per fascia oraria, giorno, settimana del mese o mese dell'anno.
- Ultime 10 registrazioni, con possibilità di eliminare un evento.
- Esportazione JSON (backup ripristinabile) e CSV; importazione JSON e cancellazione completa dello storico.
- Account email/password e sincronizzazione dello storico con Supabase.
- Manifest, icone e service worker per installazione e caricamento dell'interfaccia offline.

## Configurare Supabase

La sincronizzazione non è attiva finché non configuri un progetto Supabase. Non inserire mai la `service_role` key nel sito: il repository è pubblico. Il codice del browser usa solo la chiave pubblica anon/publishable; l'accesso ai dati è limitato dalle policy Row Level Security.

1. Crea un progetto su [Supabase](https://supabase.com/) e copia il suo **Project URL** e la chiave **publishable** (o `anon` legacy) dalle impostazioni API.
2. In Supabase apri **SQL Editor**, esegui il contenuto di [`supabase-schema.sql`](./supabase-schema.sql). Crea la tabella, le policy che isolano i dati per account e la funzione usata per sostituire lo storico durante il ripristino di un backup.
3. In **Authentication → URL Configuration**, imposta come **Site URL** l'indirizzo GitHub Pages, ad esempio `https://fettyfill.github.io/SmokeLOG/`, e aggiungi lo stesso indirizzo tra i redirect consentiti. Per provare localmente aggiungi anche l'indirizzo HTTPS o `http://localhost` usato dal server locale.
4. Inserisci URL e chiave pubblica in [`supabase-config.js`](./supabase-config.js), sostituendo i valori segnaposto.
5. Pubblica tutti i file, incluso `supabase-config.js` e `supabase-schema.sql`, su GitHub Pages. La chiave publishable/anon è visibile nel browser per definizione: **non** è una password e non va confusa con la `service_role` key.
6. Apri il sito, crea un account con la tua email, conferma l'indirizzo dal messaggio ricevuto se richiesto e accedi. Da un altro dispositivo usa lo stesso account per caricare lo storico.

Se abiliti la conferma email, il link deve riportare all'indirizzo GitHub Pages configurato. Le registrazioni aggiunte, cancellate o importate mentre si è autenticati sono sincronizzate sul database online; serve una connessione internet per scrivere o aggiornare lo storico cloud. L'archivio locale IndexedDB è una copia di appoggio, non la copia autorevole.

## Aprire il progetto in Visual Studio Code

1. Apri in VS Code la cartella `smokelog-pwa`.
2. Avvia `index.html` con Live Server o un server statico equivalente.
3. Configura URL e chiave Supabase prima di provare account e sincronizzazione. L'accesso via `file://` non è una prova valida per service worker e PWA.

## Pubblicare con GitHub Pages e installare su iPhone

1. Carica nella radice del repository tutti i file e la cartella `icons`.
2. In **Settings → Pages**, seleziona **Deploy from a branch**, il branch `main` e la cartella `/(root)`.
3. Apri l'indirizzo HTTPS mostrato da GitHub Pages. Per un repository `SmokeLOG`, il percorso mantiene le maiuscole: `https://fettyfill.github.io/SmokeLOG/`.
4. Su iPhone apri quel link in Safari, scegli **Condividi → Aggiungi alla schermata Home** e, se proposto, attiva **Apri come app web**.
5. Per accedere ai dati dopo un reset o su un nuovo dispositivo, reinstalla/apri l'app e accedi con lo stesso account Supabase.

## Dove sono memorizzati i dati?

Lo storico è salvato nel progetto Supabase e associato all'account autenticato; le policy RLS impediscono agli account di leggere o modificare gli eventi degli altri utenti. La connessione al servizio usa HTTPS. I dati **non** sono cifrati end-to-end: il progetto Supabase e i suoi amministratori possono tecnicamente accedere al database. SmokeLog non usa analytics né invia i dati a servizi diversi da Supabase per l'autenticazione e la sincronizzazione.

- Cancellare cookie, dati del browser o resettare il dispositivo rimuove la sessione e la copia locale, ma non lo storico online. Accedi di nuovo al tuo account per recuperarlo.
- Esporta comunque periodicamente **Backup e gestione dati → Esporta backup JSON** e conserva il file in un luogo sicuro, come copia indipendente dal servizio online.
- Un backup JSON esportato contiene abitudini personali: trattalo come un file privato. Il CSV è utile per consultare lo storico, ma il JSON è il formato da usare per ripristinarlo.
- L'importazione JSON sostituisce lo storico dell'account sincronizzato dopo una conferma. Esporta un backup prima se vuoi conservare i dati attuali.
- Il pulsante **Esci dall'account** termina la sessione e rimuove la copia locale dal dispositivo; lo storico remoto resta nell'account.

## Personalizzazione

- Interfaccia e colori: `style.css`.
- Etichette e struttura della pagina: `index.html`.
- Database locale, autenticazione, sincronizzazione e import/export: `app.js`.
- URL e chiave pubblica Supabase: `supabase-config.js`.
- Tabella e policy di accesso: `supabase-schema.sql`.
- Nome, colori e icone: `manifest.webmanifest` e `icons/`.
- Cache e funzionamento offline dell'interfaccia: `service-worker.js`.

Se una versione aggiornata non appare, ricarica la pagina o chiudi e riapri la web app; il service worker scarica i file aggiornati e usa la cache quando l'interfaccia è offline. Le operazioni sullo storico cloud richiedono comunque una connessione.
