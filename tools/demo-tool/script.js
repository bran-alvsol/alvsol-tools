const form = document.querySelector("#demo-form");
const results = document.querySelector("#results");

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const prefix = document.querySelector("#prefix").value.trim().toUpperCase();
  const start = Number(document.querySelector("#start").value);
  const count = Number(document.querySelector("#count").value);
  const folios = Array.from({ length: count }, (_, index) => `${prefix}-${start + index}`);

  results.innerHTML = folios.map((folio) => `<li>${folio}</li>`).join("");
});

form.dispatchEvent(new Event("submit"));
