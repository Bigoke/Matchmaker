"""Builds dist/Matchmaker.html from src/ (single offline file)."""
import os
here = os.path.dirname(os.path.abspath(__file__)); s = os.path.join(here, 'src')
rd = lambda n: open(os.path.join(s, n), encoding='utf-8').read()
js = "\n".join(rd(n) for n in ['engine.js','ui.js','ui2.js','ui3.js','ui4.js','ui5.js','ui6.js','boot.js'])
out = rd('template.html').replace('/*__CSS__*/', rd('style.css')).replace('/*__JS__*/', js.replace('</script>', '<\\/script>'))
os.makedirs(os.path.join(here,'dist'), exist_ok=True)
open(os.path.join(here,'dist','Matchmaker.html'),'w',encoding='utf-8').write(out)
open(os.path.join(here,'launcher','Matchmaker.html'),'w',encoding='utf-8').write(out)
print(len(out))
