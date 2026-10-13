# SmokeLog — diario personale

Una piccola Progressive Web App (PWA) per registrare separatamente sigarette e canne. È realizzata con HTML, CSS e JavaScript senza framework, account, analytics, CDN o backend.

## Funzionalità incluse

- Pulsante per aggiungere una sigaretta e pulsante per aggiungere una canna.
- Salvataggio locale di ogni evento con data e ora.
- Contatori per oggi, ultimi 7 giorni, mese corrente e anno corrente.
- Grafico riepilogativo per fascia oraria, giorno, settimana del mese o mese dell'anno.
- Ultime 10 registrazioni con possibilità di eliminare un evento errato.
- Esportazione dello storico in JSON (backup ripristinabile) e CSV.
- Importazione di un backup JSON, con conferma prima di sostituire i dati correnti.
- Cancellazione completa dello storico, con conferma.
- Manifest, icone e service worker per installazione in Home e apertura offline dopo il primo caricamento riuscito.

## Aprire il progetto in Visual Studio Code

1. Estrai la cartella `smokelog-pwa` in una posizione comoda.
2. Apri Visual Studio Code e scegli **File → Apri cartella…**; seleziona `smokelog-pwa`.
3. Per un'anteprima locale, installa l'estensione **Live Server** di Ritwick Dey (oppure usa un server statico equivalente) e avvia `index.html` con Live Server.
4. Dal PC apri l'indirizzo locale proposto da Live Server. I dati di prova resteranno nel browser e nell'origine locale che stai usando.

> Aprire `index.html` facendo doppio clic (URL `file://`) non è una prova completa: service worker e installazione PWA richiedono HTTPS o un ambiente locale come `localhost`.

## Pubblicarla gratis per usarla su iPhone e condividerla

Questa versione è una PWA statica. Puoi distribuire gli stessi file tramite GitHub Pages o un altro hosting statico HTTPS. Non è necessario configurare un server applicativo o un database.

### Pubblicazione con GitHub Pages

1. Crea un repository GitHub. Se vuoi la distribuzione gratuita più semplice, impostalo come **pubblico**: i file del progetto saranno visibili a chiunque, ma il codice non contiene le tue registrazioni personali.
2. Carica nella radice del repository tutti i file e la cartella `icons` di questo progetto.
3. Nel repository apri **Settings → Pages**.
4. In **Build and deployment**, scegli la pubblicazione da un branch, seleziona `main` e la cartella `/ (root)`, quindi salva.
5. Attendi la pubblicazione indicata da GitHub Pages e apri l'indirizzo HTTPS mostrato nelle impostazioni.
6. Ogni volta che modifichi il codice in VS Code, esegui commit e push verso il repository; GitHub Pages pubblicherà la versione aggiornata. Anche un aggiornamento del service worker verrà rilevato dal browser.

I percorsi nei file sono relativi, perciò la PWA può funzionare anche quando è pubblicata in una sottocartella come `https://utente.github.io/nome-repository/`.

### Installarla su iPhone

1. Apri il link HTTPS in **Safari** su iPhone.
2. Tocca **Condividi**.
3. Seleziona **Aggiungi alla schermata Home**.
4. Lascia attivo **Apri come app web** se l'opzione viene mostrata, quindi tocca **Aggiungi**.
5. Avvia SmokeLog dalla nuova icona. Aprila una prima volta mentre sei online, così il service worker può memorizzare i file per l'uso offline.

I tuoi amici possono installarla allo stesso modo. Tutti useranno il medesimo codice pubblicato, ma ogni dispositivo avrà il proprio archivio locale separato.

## Dove sono memorizzati i dati?

Gli eventi sono salvati in **IndexedDB** nel profilo del browser/origine usata sul dispositivo. Il codice dell'app viene scaricato dall'hosting, ma l'app non invia le registrazioni a un server e non usa analytics o servizi esterni.

Da ricordare:

- Non esiste sincronizzazione automatica tra dispositivi.
- I dati possono essere eliminati da chi cancella i dati del sito/browser o resetta il dispositivo. Usa periodicamente **Backup e gestione dati → Esporta backup JSON**.
- L'importazione JSON sostituisce tutto lo storico attuale sul dispositivo, dopo una conferma. Esporta prima un backup se vuoi conservare entrambi gli archivi.
- Il CSV è utile per consultare o elaborare lo storico in un foglio di calcolo, ma il JSON è il formato da usare per ripristinare i dati.
- Un backup esportato può contenere abitudini personali: trattalo come un file privato.
- Non usare la versione locale con URL `localhost` sul PC come se fosse il link da condividere: ogni dispositivo deve aprire l'indirizzo HTTPS pubblicato.

## Personalizzazione

- Interfaccia e colori: `style.css`.
- Etichette e struttura della pagina: `index.html`.
- Contatori, statistiche, database locale, import/export: `app.js`.
- Nome, colori della schermata e icone installate: `manifest.webmanifest` e `icons/`.
- Cache e comportamento offline: `service-worker.js`.

Dopo aver modificato i file, prova sempre la versione in locale e verifica la versione pubblicata su iPhone. Se il browser continua a mostrare una versione precedente, chiudi e riapri la web app o ricarica la pagina; il service worker di questo progetto prova prima a caricare i file aggiornati e usa la cache quando è offline.

## Limiti intenzionali di questa prima versione

- Non crea account e non sincronizza i dati tra persone.
- Non stima automaticamente quantità o contenuto: registra un evento per ogni tocco.
- Mostra le ultime 10 registrazioni nella schermata principale; il backup JSON/CSV contiene l'intero storico.
