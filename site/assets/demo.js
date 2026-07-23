/* demo.js — realce leve dos vídeos de demonstração (.demo).
   Progressive enhancement: sem este script, o <video> mantém os
   controles nativos e o poster (o markup já traz `controls`), então
   o vídeo continua reproduzível. Com JS, escondemos os controles
   nativos até o primeiro play e mostramos um botão de play próprio;
   ao tocar, devolvemos os controles nativos (scrubber, volume).

   O botão de play só é revelado (via classe .demo-enhanced, no CSS)
   depois que este script wireou tudo — se ele não rodar, o overlay
   nunca aparece e os controles nativos permanecem acessíveis. */
(function () {
  var demos = document.querySelectorAll(".demo");
  if (!demos.length) return;

  demos.forEach(function (demo) {
    var video = demo.querySelector("video");
    var play = demo.querySelector(".demo-play");
    if (!video || !play) return;

    function start() {
      demo.classList.add("is-playing");
      video.setAttribute("controls", "");
      var p = video.play();
      if (p && typeof p.catch === "function") { p.catch(function () {}); }
    }

    play.addEventListener("click", start);

    // Se começar a tocar por qualquer outro caminho, some com a capa
    // e garante os controles nativos.
    video.addEventListener("play", function () {
      demo.classList.add("is-playing");
      video.setAttribute("controls", "");
    });

    // Só agora, com o botão já funcional: esconde os controles nativos
    // e revela a capa. Se este trecho não rodar, o <video controls>
    // segue tocável e o overlay fica oculto.
    video.removeAttribute("controls");
    demo.classList.add("demo-enhanced");
  });
})();
