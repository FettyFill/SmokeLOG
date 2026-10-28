# Registro delle modifiche

Il registro descrive le modifiche del codice, non certifica che siano già pubblicate.

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
