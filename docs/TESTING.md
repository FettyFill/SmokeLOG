# SmokeLOG — guida per tester e verifiche

**Beta 1.2, collaudo pilota locale aggiornato al 2 novembre 2026:** `npm run check`, `npm test` (26 test) e `npm run test:ui` (4 scenari browser su mobile e desktop) superati. La build viene eseguita automaticamente prima dei controlli. I test coprono dati, SQL locale, concorrenza, backup, statistiche e flussi browser. Il collaudo non certifica Supabase remoto, Safari/iPhone o altri dispositivi fisici; vedere [UPGRADE-1.2.md](UPGRADE-1.2.md).

Beta 1.1 · 28 ottobre 2026. Referente: Filippo Roggia, filippo.lumia0@gmail.com.

## Preparazione

Usare dati fittizi e account dedicati al collaudo. Annotare dispositivo, sistema operativo, browser, ambiente (anteprima/staging/sito pubblico) e data. L'anteprima integrata non usa il cloud. Le prove Supabase richiedono un ambiente con configurazione e redirect appropriati.

## Controlli automatici per chi sviluppa

```sh
npm ci
npm run check
npm test
npm run test:ui
```

I test UI usano la porta 49173: fermare l'anteprima prima di eseguirli. In locale viene utilizzato Chrome installato; la CI usa Chromium. Non servono credenziali reali. Le immagini e i risultati UI sono prodotti in `test-results/`, escluso da Git.

## Percorso di prova nell'app

| Prova | Azione | Risultato atteso |
| --- | --- | --- |
| Registrazione | Aggiungere un consumo e un acquisto fittizio | Conteggio e spesa corretti; entrambi presenti nello storico |
| Reload | Ricaricare dopo il salvataggio | I dati rimangono |
| Categorie | Rinominare, riordinare e nascondere un pulsante | Le impostazioni persistono dopo reload; lo storico resta consultabile |
| Modifica in corso | Scrivere un nome mentre avviene un aggiornamento | Il campo non viene ricreato e il testo digitato non scompare |
| Selezione | Trascinare su etichette e selezionare testo in un input | Etichette non evidenziate; input selezionabile e modificabile |
| Icona | Aprire Impostazioni dalla barra inferiore | Ingranaggio centrato e leggibile, controllo funzionante |
| Storico | Cambiare la data di una voce e cancellarne un'altra | Statistiche coerenti con la modifica e voce cancellata non visibile |
| Obiettivi | Salvare budget e limite; ricaricare | Valori conservati per lo stesso archivio locale |
| Simulatore | Confermare 13 e poi 14 giorni; variare la percentuale | Con 13 giorni la stima resta nascosta; da 14 usa gli acquisti dei soli giorni confermati |
| Conferma giornata | Confermare un giorno e aggiungere, modificare o eliminare una voce con quella data | La conferma viene rimossa e l'app chiede di rivedere e riconfermare il giorno |
| Quantità storiche | Aprire in modifica una registrazione senza quantità e poi esportare CSV | Nessuna quantità viene inventata: va specificata esplicitamente; il CSV lascia vuoti i dati sconosciuti |
| Nessun dato | Aprire Consapevolezza su archivio vuoto | Nessuna percentuale infinita o stima presentata come attendibile senza acquisti |
| JSON | Esportare e reimportare una copia valida | Unione per ID; modifiche più recenti non sostituite da copie vecchie |
| Offline | Dopo il primo caricamento, disattivare la rete e riaprire | Interfaccia e archivio locale disponibili; nuove voci salvate localmente |
| Mobile | Test browser a 320, 375, 390 e 430 px; poi dispositivo reale | Nessun overflow orizzontale; controlli raggiungibili |
| Accessibilità | Navigare da tastiera e abilitare riduzione movimento | Focus visibile, input utilizzabili, animazioni disattivate |

Il simulatore richiede almeno 14 giornate confermate nei 28 giorni precedenti; usa gli acquisti registrati in quei giorni, quindi acquisti di scorta e prezzi variabili possono rendere la simulazione poco rappresentativa. Gli obiettivi sono contenuti nel documento di consapevolezza sincronizzato e nel backup JSON v4.

## Collaudo cloud, prima del rilascio

1. Accedere allo stesso account di prova su due dispositivi. Aggiungere/modificare/cancellare e controllare la convergenza.
2. Durante un sync, registrare un'altra voce; verificare che resti visibile anche dopo reload e sul secondo dispositivo.
3. Lavorare offline, riattivare la rete e verificare la propagazione senza duplicazioni.
4. Accedere a un secondo account distinto: nessun dato del primo deve essere restituito dal server.
5. Personalizzare i pulsanti con account collegato e controllare la persistenza dopo reload, logout/login e riapertura della PWA.
6. Verificare registrazione, conferma email e recupero password nella casella reale di un account di test. Non considerare la sola risposta HTTP come prova della consegna.
7. Solo con un account sacrificabile, provare la cancellazione definitiva seguendo [RELEASE.md](../RELEASE.md), inclusi foto e fallimenti simulati. Verificare il risultato su Auth, database e storage.
8. Verificare Safari/iPhone e l'installazione PWA. I test Chrome non sostituiscono questa prova.

## Come segnalare un problema

Inviare al referente una descrizione con:

- ambiente, dispositivo e browser;
- data/ora e passaggi precisi;
- risultato atteso e risultato ottenuto;
- frequenza (sempre/saltuario) e stato della rete;
- eventuale screenshot con dati fittizi o oscurati.

Non inviare password, chiavi amministrative, token di sessione, backup personali o screenshot che li mostrino. Per una possibile perdita dati, evitare tentativi ripetuti di importazione o cancellazione prima di aver descritto il problema.

## Feedback dopo una settimana

Annotare se registrare un consumo è rapido, se i confronti sono comprensibili, se si torna spontaneamente nell'app e quali passaggi creano attrito. È sufficiente raccogliere feedback qualitativo: non è necessario richiedere lo storico dei consumi dei tester.
