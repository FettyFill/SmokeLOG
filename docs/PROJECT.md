# SmokeLOG — documentazione ufficiale del progetto

Versione documentata: beta 1.1 / pacchetto 1.1.0. Aggiornamento: 28 ottobre 2026. Referente: Filippo Roggia, filippo.lumia0@gmail.com.

Questo documento descrive il codice presente nella cartella di progetto. Non certifica il deploy remoto, la conformità legale o l'assenza di vulnerabilità. Lo stato verificato è mantenuto in [STATUS.md](STATUS.md).

## 1. Scopo e pubblico

SmokeLOG permette di annotare rapidamente consumi e acquisti e osservarne frequenza e costo, senza giudizi. La fase attuale è una beta privata per tester invitati. Non sono presenti pagamenti, abbonamenti o telemetria di prodotto. La monetizzazione e la distribuzione pubblica non fanno parte dell'implementazione attuale.

Gli obiettivi sono scelte personali: non sono indicazioni mediche o soglie di consumo sicuro. Categorie diverse contano come registrazioni distinte, senza equivalenza di dose.

## 2. Navigazione e funzioni

| Area | Comportamento |
| --- | --- |
| Oggi | Un pulsante per categoria attiva; un clic registra un consumo con data/ora. Gli acquisti si inseriscono con categoria e importo. |
| Statistiche: Spese | Totali, andamento temporale e ripartizione per categoria nel periodo scelto. |
| Statistiche: Quantità consumate | Conteggi, distribuzione temporale e dettaglio delle categorie. |
| Statistiche: Consapevolezza | Confronti tra settimane complete, spesa del mese, fasce di attività, obiettivi e simulatore. Usa finestre dedicate, indipendenti dal selettore Oggi/7 giorni/Mese/Anno. |
| Storico | Lista con filtri, caricamento progressivo, modifica data/ora e cancellazione di singole voci. |
| Impostazioni | Account, nickname/foto, nomi/ordine/visibilità delle categorie, protezione archivio, import/export, privacy e supporto. |

I testi dell'interfaccia non si selezionano con trascinamenti o tocchi; input, textarea e contenuti modificabili mantengono la selezione. La navigazione usa SVG; l'icona impostazioni è un ingranaggio simmetrico. Le animazioni rispettano `prefers-reduced-motion`. La navigazione da tastiera e le etichette accessibili restano disponibili; non è stata effettuata una certificazione completa di accessibilità.

## 3. Componenti

| Componente | Responsabilità |
| --- | --- |
| `index.html`, `style.css` | Struttura, controlli, layout responsive e stile scuro con accenti menta |
| `app.js` | Stato dell'app, rendering, IndexedDB, account, sync, backup e gestione obiettivi |
| `insights.js` | Funzioni pure per confronti, distribuzioni, validazione obiettivi e risparmio |
| `supabase-config.js` | URL, chiave pubblica e flag `accountDeletionEnabled` |
| `supabase-schema.sql` | Tabelle, vincoli, RLS, bucket privato, merge e revisioni per sync |
| `supabase/functions/delete-account/` | Handler server per eliminazione account e foto |
| `service-worker.js` | Cache della shell e caricamento offline; versione corrente v39 |
| `tests/`, `e2e/` | Test dati, SQL, handler server e browser |

Il sito non richiede compilazione né framework. Il server di anteprima integrato è solo uno strumento di sviluppo; non sostituisce Supabase. GitHub Actions verifica il codice senza pubblicarlo.

## 4. Archivio e confini di persistenza

IndexedDB `smokelog-local-db`, versione 6, contiene gli store `events`, `purchases`, `categories`, `profile-drafts` e `sync-state`. I record del diario sono associati a `ownerId`; `localKey` combina proprietario e ID. L'archivio guest e quelli degli account sono separati.

| Dato | Locale | Cloud | Backup JSON dello storico |
| --- | --- | --- | --- |
| Consumi e acquisti visibili | IndexedDB | Sì, con account | Sì |
| Categorie | IndexedDB + fallback locale delle modifiche | Sì, con account | Sì |
| Record eliminati | IndexedDB, contrassegnati con `deletedAt` | Record con `deleted_at` | Non esportati come storico visibile |
| Obiettivi e simulatore | localStorage, per archivio | No | No |
| Preferenze di visualizzazione | localStorage | No | No |
| Sessione | localStorage | Autenticazione Supabase | No |
| Foto profilo | Bozza locale quando necessaria | Bucket privato Supabase | No |
| Cursore e copia cloud | Store `sync-state` | Revisioni server corrispondenti | No |

Collegare un account importa l'archivio guest nel relativo archivio. Il trasferimento e la pulizia delle copie guest avvengono nella stessa transazione, preservando modifiche guest successive alla fotografia iniziale. Il logout torna all'archivio guest senza cancellare la copia locale dell'account.

## 5. Sincronizzazione

1. Legge gli archivi pertinenti usando l'indice del proprietario.
2. Recupera le modifiche server successive al cursore, a pagine, con `smokelog_changes`. Se il server non ha ancora questo RPC, usa la lettura completa.
3. Unisce i record per ID e data di modifica; per le categorie mantiene le modifiche locali ancora in attesa di conferma. I default guest non sono trattati come nuove personalizzazioni.
4. Invia soltanto i record assenti o più recenti rispetto alla copia cloud attraverso `merge_smokelog_data`.
5. Recupera le modifiche confermate dal server e ricontrolla l'archivio locale.
6. Salva dati, migrazione guest e cursore in una transazione IndexedDB. Il confronto con la fotografia originaria protegge scritture intervenute durante la rete, incluse quelle di altre schede.

Le richieste ravvicinate sono accorpate con un ritardo di 250 ms. Le modifiche intervenute durante un sync possono programmare un ulteriore passaggio. Le revisioni server sono separate da `updated_at`: permettono il download incrementale indipendentemente dall'orologio del dispositivo. Le revisioni sono serializzate per account con lock transazionale.

Limiti: l'app conserva e legge ancora lo storico locale completo; non è un database locale a memoria costante. Il conflitto sullo stesso record non offre una cronologia delle versioni né una scelta manuale. La correttezza sotto connessioni PostgreSQL concorrenti e i limiti di carico richiedono ancora collaudo remoto.

## 6. Backup e cancellazione

Il JSON esporta lo storico visibile e le categorie (schema 3). L'importatore accetta gli schemi 1–3, valida il file prima della modifica e conserva le date originali. Per vecchi record privi di data di modifica usa i riferimenti temporali disponibili, senza rendere il backup automaticamente più recente al momento dell'importazione. Il limite del file è 10 MB.

L'importazione unisce e non sostituisce integralmente l'archivio: non deve far riapparire record con cancellazioni più recenti. Il CSV è un formato di consultazione, non di ripristino. I backup esportati restano sotto il controllo dell'utente.

“Elimina tutto lo storico” contrassegna consumi e acquisti come eliminati per propagare la modifica; i dati originari restano nei record. La cancellazione definitiva dell'account è diversa: verifica l'identità sul server, elimina le foto, poi elimina l'utente Auth; le chiavi esterne rimuovono lo storico e le categorie. La funzione è implementata ma il comando è disabilitato nel client fino al deploy e collaudo. Le copie su altri dispositivi e i backup esportati non sono rimossi da remoto.

## 7. Formule di Consapevolezza

- Spesa del mese: somma degli acquisti del mese locale corrente fino all'istante attuale.
- Media giornaliera: acquisti dei 28 giorni completi precedenti, divisi per 28. Oggi è escluso.
- Variazione settimanale: `(attuale − precedente) / precedente × 100`, arrotondata all'intero. Le finestre sono gli ultimi 7 giorni completi e i 7 precedenti. Con base zero non viene mostrata una percentuale infinita.
- Fasce orarie: 00–06, 06–12, 12–18, 18–24, secondo l'ora locale. Le fasce e i giorni a pari merito vengono riportati insieme.
- Categoria obiettivo: filtra i conteggi e la distribuzione dei consumi; budget e spese comprendono tutte le categorie di acquisto.
- Budget: confronto tra spesa del mese e importo scelto. Il limite giornaliero può essere zero.
- Risparmio: `spesa_28_giorni / 28 × giorni × percentuale / 100`, con giorni pari a 30 o 365 e arrotondamento ai centesimi. Con nessun acquisto nel periodo viene mostrata l'assenza di una base di calcolo.

I giorni senza registrazioni contano zero, non sono imputati come dati mancanti. Le simulazioni assumono prezzi e abitudini costanti e non convertono automaticamente un minor consumo in minori acquisti. I confini dei giorni sono costruiti nel calendario locale, anche durante cambi di ora legale.

## 8. Sicurezza, supporto e manutenzione

RLS limita gli archivi per account; la chiave pubblica del browser non sostituisce le policy. La service-role key deve restare nell'ambiente server. La funzione di cancellazione ricava l'identità da Supabase Auth e non accetta l'ID dell'utente da eliminare dal client. Le origini ammesse si configurano con `SMOKELOG_ALLOWED_ORIGINS`.

La sessione nel browser e l'assenza di cifratura end-to-end sono limiti da considerare su dispositivi condivisi. Il progetto non aggiunge analytics; hosting e fornitori possono produrre log tecnici. Le pagine privacy/termini sono testi della beta ancora da completare, non prova di conformità.

Per incidenti o problemi scrivere al referente senza includere token, credenziali o storico personale. Segnalare versione, ambiente e passaggi riproducibili. Prima dei rilasci eseguire le verifiche della [guida tester](TESTING.md) e della [guida al rilascio](../RELEASE.md). Aggiornare questo documento quando cambiano modelli dati, formule o comportamenti, e registrare le modifiche in [CHANGELOG.md](../CHANGELOG.md).
