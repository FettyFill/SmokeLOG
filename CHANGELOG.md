# Registro delle modifiche

Il registro descrive le modifiche del codice, non certifica che siano già pubblicate.

## 1.2.0 — 30 ottobre 2026

- Sorgenti separati per account, database, sincronizzazione, calcoli e interfaccia; CSS ordinato in sei moduli e build senza nuove dipendenze.
- Collaudo pilota locale aggiornato il 2 novembre: 26 test automatici e SQL e 4 scenari browser mobile/desktop superati.
- La simulazione di risparmio richiede almeno 14 giornate confermate su 28; i conteggi delle spese usano solo acquisti dei giorni confermati.
- Le modifiche a consumi e acquisti rimuovono la conferma della giornata interessata e invitano a rivederla; l'importazione e l'annullamento seguono la stessa regola.
- Le registrazioni storiche senza quantità restano sconosciute: editor e CSV non assegnano più automaticamente una quantità pari a uno.
- L'intenzione "Smettere" non è proposta come percorso finché non è disponibile un programma dedicato; i dati legacy restano conservati e richiedono una scelta esplicita per aggiornare la preferenza.
- Timeout cloud, codici errore preservati, controllo delle revisioni server e risoluzione esplicita dei conflitti.
- Shell PWA coerente con aggiornamento richiesto dall’utente; nessun fallback HTML per risorse mancanti.
- Annullamento rapido, inserimento retrodatato di consumi e acquisti, modifica di categoria/quantità/unità/importo e blocco date future.
- Stato del salvataggio, aggiornamento dei totali al ritorno nell’app e al cambio di giorno anche senza account.
- Percorsi osservare/ridurre/smettere, diario delle voglie, contesto/intensità facoltativi, esperimento settimanale e promemoria nell’app aperta.
- Giorni confermati e copertura esplicita; confronti solo per periodi completi, nessun falso picco uniforme.
- Backup v4 con dettagli e diario, obiettivi cloud, CSV arricchito; lettura dei backup precedenti.
- Consapevolezza più compatta, obiettivi in alto, dettagli espandibili e campi mobile di almeno 16 px.
- Verificati 24 test applicativi/SQL, 4 scenari browser mobile/desktop e sintassi. Restano da eseguire migrazione remota e prove su iPhone/Safari fisico.

## Beta 1.1 — 28 ottobre 2026

### Aggiunte

- Statistiche → Consapevolezza: spesa, confronti tra settimane complete, distribuzioni, budget, limite giornaliero e simulatore di risparmio.
- Download incrementale per revisioni server, cache e cursore persistiti con i dati.
- Handler server per eliminazione account/foto, dietro flag client disabilitato fino al collaudo remoto.
- Pagine privacy/condizioni della beta e contatti del titolare.
- Test applicativi, SQL e UI; workflow GitHub Actions.
- Documentazione funzionale/tecnica, report datato e guida tester.

### Correzioni

- Default guest che potevano sovrascrivere le impostazioni dei pulsanti dell'account.
- Proprietario dei record durante il trasferimento guest/account.
- Scritture concorrenti durante il salvataggio finale del sync.
- Preferenze delle categorie importate che potevano ripristinare valori più vecchi.
- Conservazione delle date originarie e fallback temporali nei backup.
- Interruzione del campo di rinomina durante aggiornamenti in background.
- Icona delle impostazioni sostituita con un ingranaggio simmetrico.

### Miglioramenti

- Upload delle differenze, accorpamento delle richieste e letture per proprietario.
- Commit atomico e cancellazione dello storico senza sostituzione indiscriminata dei record.
- Transizioni brevi, supporto reduced motion e layout responsive.
- Testi dell'interfaccia non selezionabili; selezione mantenuta nei campi modificabili.
- README riorganizzato e stato del rilascio aggiornato con la conferma SQL del titolare.
- Cache PWA aggiornata a `smokelog-shell-v39`.

### Attivazione

Lo schema SQL risulta eseguito secondo conferma del titolare. Deploy dei file statici, funzione di cancellazione account e collaudo remoto restano da confermare. Consultare [RELEASE.md](RELEASE.md).
