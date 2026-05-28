
// ========== guia ==========
const GUIDE = {
  pt: `
<h2>Guia — Calculadora de XP/h</h2>

<h3>O que é</h3>
<p>Esta é uma calculadora interativa que simula hunts de Tibia para responder uma pergunta específica: <strong>qualquer aumento de dano, por menor que seja, traz ganho real de XP/hora?</strong> A resposta curta é sim — e a calculadora existe para demonstrar isso de forma que ninguém possa contestar.</p>
<p>Por baixo do capô, a cada recálculo são simuladas cerca de <strong>24.600 horas de hunt</strong> — 41 níveis de dano diferentes (de +0 até +40), cada um rodado em 60 sessões independentes de 10 horas. Isso dá dados suficientes para o ganho real emergir naturalmente do ruído aleatório, sem truques estatísticos. Cada clique em "recalcular" gera novas seeds aleatórias, então você pode rodar várias vezes e confirmar que o padrão crescente se mantém em qualquer execução.</p>

<h3>O problema que ela resolve</h3>
<p>Existe um argumento comum na comunidade que diz: "Tibia é um jogo de turnos. Cada box leva um número inteiro de turnos para morrer. Se seu dano extra não for suficiente para matar a box em um turno a menos, ele não muda nada." Esse argumento parece sólido à primeira vista, mas tem um erro central: ele assume <strong>dano fixo</strong>.</p>
<p>Num cenário artificial onde você dá exatamente 500 de dano todo turno, sim, subir pra 501 pode não fazer diferença — você ainda precisa do mesmo número de turnos. Mas o jogo real não funciona assim. Há crítico que multiplica o dano. Há charm que soma dano individual em alvos aleatórios. Há variação natural que faz cada ataque cair entre ±20% do valor base. Tamanho de box que varia entre spawns. Todas essas fontes de variabilidade criam um espectro contínuo de resultados possíveis — e dentro desse espectro, cada ponto a mais de dano desloca a distribuição para a direita.</p>

<h3>Os parâmetros — o que cada um representa</h3>

<h4>Parâmetros do mob e da box</h4>
<p><strong>HP do mob</strong> (padrão 8.000) — total de vida de cada mob individual. Mais HP significa mais turnos para matar.</p>
<p><strong>XP do mob</strong> (padrão 10.000) — quanta experiência cada mob morto dá. Afeta apenas valores absolutos; ganhos percentuais permanecem os mesmos.</p>
<p><strong>Tamanho da box</strong> (padrão 8) — quantos mobs spawnam juntos. <strong>Aceita decimais</strong>: digitando 8.5, cada box sorteará entre 8 mobs (50% chance) ou 9 mobs (50% chance). Para 8.7, fica 30% de chance de ser 8 e 70% de ser 9. Útil para simular hunts onde o tamanho varia.</p>
<p><strong>Ponto de saída</strong> (padrão 3) — define com quantos mobs vivos a inteligência decide arrastar para a próxima box. Com valor 3, sai quando restam ≤3 vivos. Com valor 1, quase nunca arrasta. Com valor 5, sai mais cedo.</p>
<p><strong>Tempo entre box</strong> (padrão 6 segundos) — esse parâmetro tem dois significados conforme o modo:</p>
<ul>
<li><strong>Sem inteligência:</strong> tempo gasto caminhando até a próxima box após limpar a atual. Durante esse tempo o jogador não ataca.</li>
<li><strong>Com inteligência:</strong> duração total do arraste, que também é a duração ao longo da qual os mobs novos vão aparecendo na próxima box. Se você colocar 10s, os 8 (ou mais) mobs novos aparecem distribuídos ao longo desses 10 segundos, e o jogador continua atacando durante todo esse período.</li>
</ul>

<h4>Parâmetros de dano</h4>
<p><strong>Dano ataque 1, 2 e 3</strong> (padrões 500, 600, 1000) — o ciclo de ataques. Tibia tem spells com cooldowns diferentes, então a cada 3 turnos você usa uma spell diferente. O slider de bônus aumenta os três valores igualmente.</p>
<p><strong>Dano do charm</strong> (padrão 500) — quando o charm ativa em um mob, esse é o dano extra que ele sofre. É <strong>individual</strong>: ativa em mobs específicos, não em todos.</p>
<p><strong>Aumento crítico (%)</strong> (padrão 44) — base é 1,72x. Esse input adiciona %. O padrão de 44% resulta em 2,16x.</p>

<h4>Configurações ativas (checkboxes)</h4>
<p><strong>Charm</strong> — quando marcado, cada mob tem 10% de chance por turno de sofrer dano extra do charm. Cria dispersão nos HPs.</p>
<p><strong>Crítico aumentado</strong> — quando marcado, usa 2,16x em vez do base 1,72x.</p>
<p><strong>Inteligência</strong> — quando marcado, o jogador arrasta para a próxima box ao atingir o ponto de saída. Quando desmarcado, fica até matar o último mob.</p>
<p><strong>Dano variável (±20%)</strong> — cada ataque tem variação. Mecânica mais importante para o argumento: elimina breakpoints duros.</p>

<h3>Como os parâmetros interagem</h3>
<p>As variáveis não somam, elas se potencializam.</p>
<p><strong>Crítico sozinho</strong> tem efeito modesto: amplifica em 10% dos turnos, mas atinge todos da box ao mesmo tempo, criando pouca dispersão.</p>
<p><strong>Charm sozinho</strong> dispersa HPs, mas sem inteligência o jogador ainda espera o último mob.</p>
<p><strong>Inteligência sozinha</strong> tem efeito quase zero: sem dispersão nos HPs, todos morrem juntos no mesmo turno.</p>
<p><strong>Charm + Inteligência</strong> é onde a coisa começa: charm cria dispersão, intel captura o benefício. Ganho de +4-5% vs baseline.</p>
<p><strong>Tudo junto (Charm + Crit + Int + Var)</strong> é o cenário mais próximo do jogo real. O ganho de +0 para +40 fica em torno de +5-8%, e mais importante: visível em praticamente todo incremento de +1, refutando o argumento dos breakpoints.</p>

<h3>O que a calculadora mostra</h3>
<p><strong>Métricas do nível selecionado</strong> — quatro cards que atualizam em tempo real conforme o slider de nível.</p>
<p><strong>Comparação de dois níveis</strong> — dois sliders independentes para sobrepor distribuições. Padrão: +0 vs +40.</p>
<p><strong>Evolução dos turnos e XP/h</strong> — gráfico mais importante: duas linhas, turnos médios (descendente) e XP/h (crescente), 41 níveis.</p>
<p><strong>Curvas de distribuição</strong> — todas as 41 distribuições sobrepostas, mostrando o deslocamento.</p>
<p><strong>Tabela resumo</strong> — números brutos a cada +5 de dano: turnos, XP/h, % de ganho, diferença absoluta e ganho em 100h.</p>

<h3>Como usar para defender o argumento</h3>
<p>Configure o simulador no cenário que representa sua hunt real, ative as variáveis presentes no jogo, mova o slider e observe as métricas subindo. Aperte <code>copiar link</code> e mande para o cético — ele vai abrir o simulador exatamente no estado que você configurou, impossível contestar com "você configurou diferente".</p>
<p>Aperte <code>recalcular</code> várias vezes para mostrar que o padrão crescente é robusto: os números absolutos flutuam um pouco (aleatoriedade), mas a curva de XP/h sempre sobe.</p>
<p>O argumento dos breakpoints só se sustenta quando você elimina artificialmente a variabilidade natural do jogo. A calculadora mostra a realidade: qualquer +1 de dano empurra a distribuição de resultados levemente para a direita, e o efeito acumulado ao longo de uma hunt é real, mensurável e consistente.</p>
`,
  en: `
<h2>Guide — XP/h Calculator</h2>

<h3>What it is</h3>
<p>This is an interactive calculator that simulates Tibia hunts to answer one specific question: <strong>does any increase in damage, no matter how small, translate into real XP/hour gains?</strong> The short answer is yes — and this calculator exists to demonstrate it in a way nobody can dispute.</p>
<p>Under the hood, each recalculation simulates roughly <strong>24,600 hours of hunting</strong> — 41 different damage levels (from +0 to +40), each run across 60 independent sessions of 10 hours. That provides enough data for the real gain to emerge naturally from random noise, without statistical tricks. Each click on "recalculate" generates new random seeds, so you can run several times and confirm the rising pattern holds across any execution.</p>

<h3>The problem it solves</h3>
<p>There's a common community argument that goes: "Tibia is a turn-based game. Each box takes an integer number of turns to die. If your extra damage isn't enough to kill the box in one turn less, it changes nothing." This seems solid at first, but has a central flaw: it assumes <strong>fixed damage</strong>.</p>
<p>In an artificial scenario where you deal exactly 500 damage every turn, yes, going to 501 may not matter — you still need the same number of turns. But the real game doesn't work that way. There's critical hit that multiplies damage. There's charm that adds individual damage to random targets. There's natural variance making each attack land within ±20% of base. Box sizes that vary between spawns. All these sources of variability create a continuous spectrum of possible outcomes — and within that spectrum, each extra damage point shifts the distribution to the right.</p>

<h3>The parameters — what each one represents</h3>

<h4>Mob and box parameters</h4>
<p><strong>Mob HP</strong> (default 8,000) — total life of each individual mob. More HP means more turns to kill.</p>
<p><strong>Mob XP</strong> (default 10,000) — experience per killed mob. Only affects absolute values; percentage gains stay the same.</p>
<p><strong>Box size</strong> (default 8) — how many mobs spawn together. <strong>Accepts decimals</strong>: typing 8.5, each box rolls between 8 mobs (50% chance) or 9 mobs (50% chance). For 8.7, it's 30% chance of being 8 and 70% of being 9. Useful to simulate hunts where box size varies.</p>
<p><strong>Exit threshold</strong> (default 3) — defines with how many alive mobs intelligence decides to drag to the next box. With 3, leaves when ≤3 remain alive. With 1, almost never drags. With 5, leaves earlier.</p>
<p><strong>Box change time</strong> (default 6 seconds) — this parameter has two meanings depending on the mode:</p>
<ul>
<li><strong>Without intelligence:</strong> time spent walking to the next box after clearing the current one. The player doesn't attack during this time.</li>
<li><strong>With intelligence:</strong> total drag duration, which is also the duration over which new mobs will appear in the next box. If you set 10s, the 8 (or more) new mobs appear distributed across those 10 seconds, and the player keeps attacking throughout that period.</li>
</ul>

<h4>Damage parameters</h4>
<p><strong>Attack damage 1, 2 and 3</strong> (defaults 500, 600, 1000) — the attack cycle. Tibia has spells with different cooldowns, so every 3 turns you use a different spell. The bonus slider raises all three values equally.</p>
<p><strong>Charm damage</strong> (default 500) — when charm procs on a mob, this is the extra damage. It's <strong>individual</strong>: triggers on specific mobs, not on all.</p>
<p><strong>Crit boost (%)</strong> (default 44) — base is 1.72x. This input adds %. The default 44% results in 2.16x.</p>

<h4>Active configuration (checkboxes)</h4>
<p><strong>Charm</strong> — when checked, each mob has 10% chance per turn to take extra charm damage. Creates HP dispersion.</p>
<p><strong>Boosted crit</strong> — when checked, uses 2.16x instead of base 1.72x.</p>
<p><strong>Intelligence</strong> — when checked, the player drags to the next box upon reaching exit threshold. When unchecked, stays until the last mob dies.</p>
<p><strong>Damage variance (±20%)</strong> — each attack varies. Most important mechanic for the argument: eliminates hard breakpoints.</p>

<h3>How the parameters interact</h3>
<p>Variables don't add, they potentiate each other.</p>
<p><strong>Crit alone</strong> has modest effect: amplifies on 10% of turns but hits all box mobs simultaneously, creating little dispersion.</p>
<p><strong>Charm alone</strong> disperses HPs, but without intelligence the player still waits for the last mob.</p>
<p><strong>Intelligence alone</strong> has near-zero effect: without HP dispersion, all mobs die together on the same turn.</p>
<p><strong>Charm + Intelligence</strong> is where things start: charm creates dispersion, intel captures the benefit. Gain of +4-5% vs baseline.</p>
<p><strong>Everything together (Charm + Crit + Int + Var)</strong> is the scenario closest to real game. Gain from +0 to +40 sits around +5-8%, and more importantly: visible across practically every +1 increment, refuting the breakpoints argument.</p>

<h3>What the calculator displays</h3>
<p><strong>Metrics for selected level</strong> — four cards that update in real time as you move the level slider.</p>
<p><strong>Two-level comparison</strong> — two independent sliders to overlay distributions. Default: +0 vs +40.</p>
<p><strong>Turns and XP/h evolution</strong> — most important graph: two lines, average turns (descending) and XP/h (rising), across 41 levels.</p>
<p><strong>Distribution curves</strong> — all 41 distributions overlaid, showing the shift.</p>
<p><strong>Summary table</strong> — raw numbers every +5 damage: turns, XP/h, gain %, absolute difference and gain over 100h.</p>

<h3>How to use it to defend the argument</h3>
<p>Configure the simulator to match your real hunt scenario, enable the variables active in your game, move the slider and watch metrics climb. Hit <code>copy link</code> and send it to the skeptic — they'll open the simulator in the exact state you configured, impossible to dispute with "you set it up differently".</p>
<p>Hit <code>recalculate</code> several times to show the rising pattern is robust: absolute numbers fluctuate slightly (randomness), but the XP/h curve always rises.</p>
<p>The breakpoint argument only stands when you artificially strip out the game's natural variability. The calculator shows the reality: any +1 damage nudges the outcome distribution slightly to the right, and the accumulated effect over a hunt is real, measurable, and consistent.</p>
`
};

function openGuide() {
  $('guideContent').innerHTML = GUIDE[LANG];
  $('guideModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeGuide() {
  $('guideModal').classList.remove('open');
  document.body.style.overflow = '';
}
