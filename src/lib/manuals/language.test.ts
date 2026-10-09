import { looksEnglish } from "./language";

/**
 * The eval questions' English check (manual text spec amendment "English
 * passages only"): the same instruction in the languages a multilingual
 * manual repeats it in.
 */

const ENGLISH =
  "Set the cutting depth to the thickness of the workpiece. Less than one full tooth should be visible below the workpiece. " +
  "Before you change the blade, remove the battery from the tool and wait for the motor to stop.";

describe("looksEnglish", () => {
  it("takes an English passage, technical words and figures included", () => {
    expect(looksEnglish(ENGLISH)).toBe(true);
    expect(looksEnglish("Max. 120 °C. Use the 0.4 mm nozzle for PLA and PETG. Do not touch the hot end when the printer is on.")).toBe(true);
  });

  it("refuses the same text in French, Spanish, German, Portuguese, Italian and Dutch", () => {
    for (const text of [
      "Réglez la profondeur de coupe sur l'épaisseur de la pièce. Avant de changer la lame, retirez la batterie de l'outil et attendez que le moteur soit arrêté.",
      "Ajuste la profundidad de corte al espesor de la pieza. Antes de cambiar la hoja, retire la batería de la herramienta y espere a que el motor se detenga.",
      "Stellen Sie die Schnitttiefe auf die Dicke des Werkstücks ein. Entfernen Sie den Akku aus dem Werkzeug, bevor Sie das Sägeblatt wechseln, und warten Sie, bis der Motor steht.",
      "Ajuste a profundidade de corte para a espessura da peça. Antes de trocar a lâmina, retire a bateria da ferramenta e espere que o motor pare.",
      "Regolare la profondità di taglio sullo spessore del pezzo. Prima di cambiare la lama, rimuovere la batteria dell'utensile e attendere che il motore sia fermo.",
      "Stel de zaagdiepte in op de dikte van het werkstuk. Verwijder de accu uit het gereedschap voordat u het zaagblad vervangt en wacht tot de motor stilstaat.",
    ]) {
      expect(looksEnglish(text)).toBe(false);
    }
  });

  it("refuses Cyrillic and Greek, and text with no words", () => {
    expect(looksEnglish("Установите глубину пропила по толщине заготовки. Перед заменой пильного полотна извлеките аккумулятор.")).toBe(false);
    expect(looksEnglish("Ρυθμίστε το βάθος κοπής στο πάχος του τεμαχίου. Πριν αλλάξετε τη λάμα, αφαιρέστε την μπαταρία.")).toBe(false);
    expect(looksEnglish("12 34 56 — 7.8")).toBe(false);
  });
});
