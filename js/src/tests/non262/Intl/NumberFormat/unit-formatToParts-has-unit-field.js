// |reftest| skip-if(!this.hasOwnProperty("Intl"))

const sanctionedSimpleUnitIdentifiers = [
  "acre",
  "bit",
  "byte",
  "celsius",
  "centimeter",
  "day",
  "degree",
  "fahrenheit",
  "fluid-ounce",
  "foot",
  "gallon",
  "gigabit",
  "gigabyte",
  "gram",
  "hectare",
  "hour",
  "inch",
  "kilobit",
  "kilobyte",
  "kilogram",
  "kilometer",
  "liter",
  "megabit",
  "megabyte",
  "meter",
  "mile",
  "mile-scandinavian",
  "milliliter",
  "millimeter",
  "millisecond",
  "minute",
  "month",
  "ounce",
  "percent",
  "petabyte",
  "pound",
  "second",
  "stone",
  "terabit",
  "terabyte",
  "week",
  "yard",
  "year",
];

// Test only English and Chinese to keep the overall runtime reasonable.
//
// Chinese is included because it contains more than one "unit" element for
// certain unit combinations.
const locales = ["en", "zh"];

// Plural rules for English only differentiate between "one" and "other". Plural
// rules for Chinese only use "other". That means we only need to test two values
// per unit.
const values = [0, 1];

// Ensure unit formatters contain at least one "unit" element.

for (const locale of locales) {
  for (const unit of sanctionedSimpleUnitIdentifiers) {
    const nf = new Intl.NumberFormat(locale, {style: "unit", unit});

    for (const value of values) {
      assertEq(nf.formatToParts(value).filter(e => e.type === "unit").length > 0, true,
               `locale=${locale}, unit=${unit}`);
    }
  }

  for (const numerator of sanctionedSimpleUnitIdentifiers) {
    for (const denominator of sanctionedSimpleUnitIdentifiers) {
      const unit = `${numerator}-per-${denominator}`;
      const nf = new Intl.NumberFormat(locale, {style: "unit", unit});

      for (const value of values) {
        assertEq(nf.formatToParts(value).filter(e => e.type === "unit").length > 0, true,
                 `locale=${locale}, unit=${unit}`);
      }
    }
  }
}

if (typeof reportCompare === "function")
  reportCompare(true, true);
