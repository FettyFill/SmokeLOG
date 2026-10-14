# SmokeLog — diario personale

Una Progressive Web App (PWA) per registrare separatamente sigarette e Barnei. L'interfaccia è realizzata con HTML, CSS e JavaScript senza framework. Con la configurazione Supabase, account e database online permettono di ritrovare lo stesso storico da browser e dispositivi diversi.

## Funzionalità

- Registrazione di sigarette, Barnei, Mezza Siga e Puzzetta con data e ora.
- Contatori per oggi, ultimi 7 giorni, mese corrente e anno corrente.
- Grafico riepilogativo per fascia oraria, giorno, settimana del mese o mese dell'anno.
- Ultime 10 registrazioni, con possibilità di eliminare un evento.
- Esportazione JSON (backup ripristinabile) e CSV; importazione JSON e cancellazione completa dello storico.
- Account email/password e sincronizzazione dello storico con Supabase.
- Manifest, icone e service worker per installazione e caricamento dell'interfaccia offline.

## Configurare Supabase

La sincronizzazione non è attiva finché non configuri un progetto Supabase. Non inserire mai la `service_role` key nel sito: il repository è pubblico. Il codice del browser usa solo la chiave pubblica anon/publishable; l'accesso ai dati è limitato dalle policy Row Level Security.

1. Crea un progetto su [Supabase](https://supabase.com/) e copia il suo **Project URL** e la chiave **publishable** (o `anon` legacy) dalle impostazioni API.
2. In Supabase apri **SQL Editor**, esegui il contenuto aggiornato di [`supabase-schema.sql`](./supabase-schema.sql). Crea la tabella, le policy che isolano i dati per account e la funzione usata per sostituire lo storico durante il ripristino di un backup; aggiorna inoltre i tipi di evento ammessi.
3. In **Authentication → URL Configuration**, imposta come **Site URL** l'indirizzo GitHub Pages, ad esempio `https://fettyfill.github.io/SmokeLOG/`, e aggiungi lo stesso indirizzo tra i redirect consentiti. Per provare localmente aggiungi anche l'indirizzo HTTPS o `http://localhost` usato dal server locale.
4. Inserisci URL e chiave pubblica in [`supabase-config.js`](./supabase-config.js), sostituendo i valori segnaposto.
5. Pubblica tutti i file, incluso `supabase-config.js` e `supabase-schema.sql`, su GitHub Pages. La chiave publishable/anon è visibile nel browser per definizione: **non** è una password e non va confusa con la `service_role` key.
6. Apri il sito e scegli **Accedi o registrati → Non hai un account? Registrati**. Inserisci email, password e conferma password; il link inviato da Supabase riporta al sito autorizzato. Dopo la conferma, accedi con lo stesso account da ogni dispositivo.

Se abiliti la conferma email, il link deve riportare all'indirizzo GitHub Pages configurato. Il browser o l'app di posta possono aprire il link in una nuova scheda: non è possibile forzare il browser a riutilizzare la scheda esistente, ma SmokeLog aggiorna la scheda già aperta quando torni ad essa. In Supabase vai in **Authentication → URL Configuration** e consenti l'URL esatto della pagina pubblicata, incluso il percorso `/SmokeLOG/`. Le registrazioni aggiunte, cancellate o importate mentre si è autenticati sono sincronizzate sul database online; serve una connessione internet per scrivere o aggiornare lo storico cloud. L'archivio locale IndexedDB è una copia di appoggio, non la copia autorevole.

SmokeLog conserva la sessione sul dispositivo e prova a ripristinarla all'apertura della web app. Il token di accesso viene rinnovato quando necessario; non viene chiesto di accedere di nuovo alla sua normale scadenza. Se la sessione viene revocata o si cancellano i dati del browser, sarà necessario autenticarsi di nuovo.

### Email di registrazione e conferma

L'app invia a Supabase la richiesta di registrazione e l'indirizzo di ritorno. Una risposta positiva significa che Supabase ha accettato la richiesta, non garantisce che il provider abbia consegnato l'email. Il mittente SMTP predefinito può inviare solo a indirizzi associati all'organizzazione Supabase e ha un limite attuale di 2 email all'ora; non è il servizio adatto per consegnare conferme agli indirizzi degli utenti.

Se il messaggio non arriva:

1. Controlla **Authentication → Users**: verifica che l'utente sia stato creato e se l'email risulta confermata. Non serve cercare un account nella tabella `smokelog_events`.
2. Controlla **Authentication → Logs** per errori di invio o limiti di frequenza; verifica anche spam e che l'indirizzo inserito sia corretto.
3. Verifica **Authentication → URL Configuration**: il redirect consentito deve includere l'URL completo del sito, compreso il percorso `/SmokeLOG/`.
4. Per inviare email agli utenti, configura un provider SMTP personale in **Supabase Dashboard → Authentication → SMTP Settings**. Servono host, porta, credenziali SMTP e un mittente appartenente a un dominio verificato presso il provider; configura anche i record DNS richiesti (per esempio SPF e DKIM). Consulta la [guida ufficiale Supabase per SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Se l'app mostra **“Supabase ha raggiunto il limite temporaneo di invio email”**, smetti di premere **Registrati** e **Invia di nuovo l’email di conferma**: altri tentativi possono prolungare il blocco. Verifica prima **Authentication → Users**. Se l'utente esiste ed è in attesa di conferma, non creare account ripetuti; configura SMTP personale, poi richiedi un solo nuovo invio dopo che il limite è rientrato. L'attesa può rimuovere il rate limit temporaneo, ma non rimuove le restrizioni del mittente predefinito verso indirizzi non autorizzati.

Se l'account è in attesa di conferma, SmokeLog mostra il pulsante evidenziato **Invia di nuovo l’email di conferma**. La risposta positiva conferma solo che Supabase ha accettato la richiesta di reinvio, non che l'email sia stata recapitata. Nei log, `User repeated signup` significa che è stata richiesta di nuovo la registrazione per un indirizzo già presente: ripetere **Registrati** non è un modo affidabile per reinviare la conferma. Non disattivare la conferma email per aggirare un problema di consegna. Se la registrazione appare in **Users** ma non arriva nessuna email, la diagnosi va fatta nei log e nelle impostazioni email del progetto Supabase.

Se nei log compaiono `Invalid Refresh Token: Refresh Token Not Found`, il browser sta tentando di riusare una sessione locale non più valida. SmokeLog rimuove questa sessione e richiede un nuovo accesso; questo non elimina lo storico cloud. Il log `Mail.send` insieme a `User confirmation requested` indica che Supabase ha avviato il flusso di invio, ma non certifica la consegna alla casella.

Gli account sono elencati in **Authentication → Users**; la tabella `public.smokelog_events` contiene soltanto le registrazioni, quindi resta vuota finché un utente non confermato effettua l'accesso e aggiunge un evento.

L'app richiede un account per accedere a qualunque funzione: finché non hai effettuato l'accesso, lo sfondo resta bloccato e il modulo di accesso/registrazione si apre dal pulsante centrale.

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
