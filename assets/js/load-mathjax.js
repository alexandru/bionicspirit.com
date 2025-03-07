---
layout: null
---

(function () {
  function triggerOnce(document, f) {
    var wasLoaded = false;
    return function () {
      var shouldLoad = !wasLoaded && (
        typeof document.readyState === "undefined" ||
        document.readyState === "complete"
      );
      if (shouldLoad) {
        wasLoaded = true;
        f();
      }
    };
  }

  function loadScript() {
    console.log("Loading MathJax");

    function scriptCData(x) {
      if (x.startsWith('% <![CDATA[') && x.endsWith('%]]>')) {
        return x.substring(11,x.length-4);
      }
      return x;
    }

    // Convert existing math elements to new format
    document.querySelectorAll("script[type='math/tex']").forEach(function (el) {
      el.outerHTML = "<div class='formula-code'><span class='math inline'>" + scriptCData(el.textContent) + "</span></div>";
    });

    document.querySelectorAll("script[type='math/tex; mode=display']").forEach(function(el){
      el.outerHTML = "<div class='formula-code'><span class='math display'>" + scriptCData(el.textContent) + "</span></div>";
    });

    // Load MathJax 3
    window.MathJax = {
      tex: {
        inlineMath: [['$', '$'], ['\\(', '\\)']],
        displayMath: [['$$', '$$'], ['\\[', '\\]']],
        packages: ['base', 'ams', 'noerrors', 'noundefined']
      },
      options: {
        enableMenu: true,
        renderActions: {
          findScript: [10, function (doc) {
            document.querySelectorAll('span.math').forEach(function (node) {
              var math = node.textContent;
              node.textContent = math;
            });
          }, '']
        }
      },
      loader: {load: ['[tex]/ams', '[tex]/noerrors', '[tex]/noundefined']}
    };

    var script = document.createElement('script');
    script.src = "{% link /assets/js-managed/mathjax/es5/tex-mml-chtml.js %}";
    script.async = true;
    document.head.appendChild(script);
  }

  if (document.readyState === "complete") {
    loadScript();
  } else {
    var loader = triggerOnce(document, loadScript);
    document.addEventListener('DOMContentLoaded', loader, false);
    document.onreadystatechange = loader;
  }
})();
