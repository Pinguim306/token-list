# Análise: FWA (fwa.fun) → RobinhoodChain — Viabilidade e Plano de Desenvolvimento

> **Data:** 24/07/2026 · **Pergunta:** é possível desenvolver um site/protocolo com a mesma ideia da FWA, mas na RobinhoodChain?
> **Resposta curta: SIM, é tecnicamente possível — VIÁVEL COM RESSALVAS.** O deploy é trivial (a chain é EVM/Arbitrum Orbit com deployment permissionless), mas dois pilares da FWA não existem lá hoje: **Chainlink VRF** (exige arquitetura alternativa de aleatoriedade) e **NFTs de valor** (exige pivotar o lastro do produto). Há ainda risco regulatório (gambling) e de censura pelo sequencer da Robinhood. O plano de desenvolvimento completo está na Parte 4.

---

## Parte 1 — O que é a FWA (Fake World Assets)

**FWA** ([fwa.fun](https://www.fwa.fun/)), da TokenWorks, é um **protocolo onchain de aquisição aleatória de NFTs** ("gacha" verificável) na **Ethereum mainnet**. A estrutura é explicitamente analogizada a um par Uniswap V2.

### Mecânica central

Três papéis:

1. **Depositantes** — travam um NFT ERC-721 + um *backing* em ETH, formando uma **posição**. O backing cumpre 3 funções simultâneas: financia o *standing bid* de recompra, define o **peso de seleção** e é o stake devolvível do depositante. Ganham fees de aquisição + emissões de $FWA.
2. **Compradores** — pagam um preço derivado do pool para receber **uma posição aleatória**. Depois do sorteio, escolhem: ficar com o NFT **ou** aceitar o standing bid do depositante (recebendo ~85% do backing, em ETH ou $FWA). Nunca ficam com o NFT **e** o ETH.
3. **Protocolo** — recebe cortes limitados dos fees de aquisição/settlement, o desconto de settlement e 1% de fee de trading do $FWA.

### Fórmulas-chave

- **Peso de seleção inverso ao backing:** `peso = 1e36 / backing` — posições com pouco lastro saem com frequência (prêmio pequeno); posições valiosas são raras e persistem.
- **Preço de aquisição:** `EV × (10000 + surchargeBps) / 10000`, onde `EV = média harmônica dos backings` e o surcharge padrão é **10%** — dividido entre depositantes, allowance de $FWA ao comprador e corte do protocolo.
- **Invariante de solvência:** o contrato nunca faz pool do backing — o ETH de cada posição é contabilizado separadamente e jamais paga outra posição.
- **Crown/tithe:** o maior depósito ativo detém a "coroa" e acumula 5% de cada fee de aquisição; desafiante precisa superar o incumbente em 10%.

### Aleatoriedade e o exploit de 03/07/2026

A seleção usa **Chainlink VRF 2.5** (subscription, native payment), com settlement **FIFO estrito** para evitar manipulação de timing do callback. Mesmo assim, o protocolo real foi **explorado em ~03/07/2026**: um atacante mutou o estado do pool **entre o request e a aplicação da aleatoriedade**, direcionando o sorteio para o ativo mais valioso do pool (**CryptoPunk #5450, ~US$ 66k**). A TokenWorks congelou o protocolo em modo *withdraw-only*, fez snapshot e compensou o dono. **Lição central para qualquer reimplementação: congelar preço/pesos/conjunto de posições no request ("freeze-at-request"), não no callback.**

### Token $FWA

ERC-20 com split 50% pool Uniswap v4 / 30% emissões / 20% claims por snapshot. Emissões por 15 dias: 1%/dia a depositantes (ponderado por √backing) + 1%/dia a compradores (pote diário pro-rata). Fee de 1% em trading via **hook Uniswap v4**, com buyback roteado 40% depositantes / 40% compradores / 20% burn. Contratos verificados no Etherscan (core `0xB276...Ac1c`, token `0xa0Df...C845`) — **sem auditoria externa publicada** (e foi drenado).

---

## Parte 2 — RobinhoodChain como alvo de deploy

| Item | Valor |
|---|---|
| Stack | Arbitrum Orbit / Nitro ("Dedicated Chain"), L2 de Ethereum, mainnet desde 01/07/2026 |
| Chain ID | **4663** (mainnet) / **46630** (testnet) |
| RPC | `https://rpc.mainnet.chain.robinhood.com` / `https://rpc.testnet.chain.robinhood.com` (+ Alchemy, Chainstack, QuickNode) |
| Explorer | Blockscout: `robinhoodchain.blockscout.com` |
| Gas token | ETH · Stablecoin nativa: **USDG** (Paxos) |
| Faucet testnet | `https://faucet.testnet.chain.robinhood.com` (ETH de teste + Stock Tokens de teste) |
| Deploy de contratos | **Permissionless hoje** — Solidity/Vyper sem modificação, Foundry/Hardhat, verificação Blockscout |
| Blocos | ~100ms, sequencer único operado pela Robinhood (com screening de compliance) |
| Ecossistema | Uniswap, Morpho, Chainlink (CCIP/Feeds/Streams — **sem VRF**), LayerZero, OpenSea, ERC-4337 nativo |
| Ressalvas | `block.prevrandao` constante (=1); `block.number` ≈ bloco L1; code size 96 KB; admin possui setter de allowlist de deploy sem delay (não é L2BEAT Stage 1) |

---

## Parte 3 — Avaliação de viabilidade


### 1. Veredito

**VIÁVEL COM RESSALVAS.** O deploy é tecnicamente trivial — a RobinhoodChain é uma L2 Arbitrum Orbit totalmente EVM-compatível, com deployment permissionless hoje e todo o tooling padrão (Foundry/Hardhat/Blockscout). Porém, dois pilares do FWA não existem na chain: Chainlink VRF não está deployado (exigindo arquitetura de aleatoriedade alternativa, com risco agravado pelo sequencer único da Robinhood — exatamente a superfície do exploit real de 03/07/2026) e não há NFTs blue-chip nem bridge ERC-721 para lastrear o pool de prêmios. Somam-se o risco regulatório de gambling (o mecanismo cumpre os três prongs do teste americano) e o poder real de censura da Robinhood via sequencer e ToS. É construível, mas seria um produto materialmente diferente e mais frágil que o FWA original.

### 2. Compatibilidade técnica

**Portabilidade Solidity: alta, com ajustes pontuais de Nitro.**

- **EVM:** contratos Solidity/Vyper deployam sem modificação. Todo o stack do FWA (core pool, ERC-20 com hook, Splitter, Whitelist, Merkle claim) porta diretamente. Bônus: limite de code size de 96 KB (vs. 24 KB no mainnet) facilita o contrato core monolítico do FWA.
- **Desvios Nitro a tratar no código:** `block.number` retorna estimativa de L1 (usar `ArbSys(0x64).arbBlockNumber()` para janelas de settlement de 24h/7d e timeouts de seleção medidos em blocos); `block.prevrandao` é constante (=1) — jamais usar; gás em duas partes (L2 + L1 data fee) via `ArbGasInfo`; aliasing de endereços L1→L2.
- **Uniswap v4 hook:** há Uniswap deployado na chain, mas **é preciso confirmar se é v4 com PoolManager** (não confirmado nas fontes) — o FWATokenHook (fee de 1% + gating de transferências) depende disso. Verificar na página de protocol-contracts da docs oficial e no Blockscout. Alternativa: reimplementar o gating como ERC-20 com fee nativa, sem hook.
- **Deployment:** aberto/permissionless hoje — sem allowlist, KYC ou aprovação. **Ressalva estrutural:** o RollupProxy admin possui um *setter de allowlist* que pode ligar um allowlist de deployers a qualquer momento, sem delay de upgrade nem janela de saída (L2BEAT: não é Stage 1). A permissão de hoje não é garantia contratual.
- **Tooling:** Foundry, Hardhat, ethers/viem/Wagmi, verificação Blockscout, RPCs Alchemy/QuickNode, ERC-4337 nativo. Testnet (chainId 46630) com faucet funcional. Indexação via subgraph não confirmada — verificar se The Graph suporta a chain ou usar APIs do Blockscout/Alchemy.

### 3. Bloqueador crítico: aleatoriedade

**Chainlink VRF — o coração do FWA — não existe na RobinhoodChain.** O lançamento day-one da Chainlink cobre apenas CCIP, Data Feeds e Data Streams; VRF v2.5 não roda em nenhuma chain Orbit (só Arbitrum One). E não há fallback nativo: `prevrandao` é constante e a Arbitrum deliberadamente não faz bridge do RANDAO da L1.

Opções reais, em ordem:

1. **VRF cross-chain via CCIP (única disponível hoje, sem onboarding):** consumer na RH Chain envia mensagem CCIP a um contrato na Arbitrum One que pede VRF v2.5 e devolve o resultado via CCIP. Mantém a âncora de confiança Chainlink do FWA, mas adiciona minutos de latência, custo de dois legs CCIP + fulfillment, e uma superfície de confiança maior (DON do CCIP + DON do VRF + dois sequencers). Custo/latência exatos: **medir na testnet antes de decidir**.
2. **Pyth Entropy (melhor opção nativa):** commit-reveal de duas partes, imparcial se qualquer parte for honesta, barato e rápido — mas **não confirmado na chainId 4663**; exige a Pyth deployar o contrato e rodar o keeper (verificar na chainlist da Pyth e, se ausente, negociar onboarding).
3. **Supra dVRF / Gelato VRF:** ambos comprovados em Orbit (ApeChain; Gelato é RaaS de Orbit), mas exigem BD/onboarding do provedor para a chain.

**Mudança de design obrigatória — a lição do exploit de 03/07/2026:** o FWA foi drenado (CryptoPunk #5450, ~US$ 66k) por mutação de estado entre o request e a aplicação da aleatoriedade, não por comprometimento do VRF. Na RH Chain esse vetor é *pior*: o sequencer único da Robinhood ordena FCFS com visibilidade total do mempool e controla **quando** o callback de fulfillment é incluído e o que entra imediatamente antes/depois. Portanto o redesign deve:

- **Congelar tudo no request:** snapshot de preço, `totalWeight` e conjunto de posições no momento do request — nunca no callback; nenhuma entrada/saída de posição pode afetar um draw em voo.
- Escrow do ETH do comprador no request; settlement FIFO estrito e ordem-invariante (settle k só após k-1).
- Callback mínimo (armazena a random word) + `settle()` separada chamável por qualquer um; refunds pull-based.
- Callback atrasado/retido deve ser falha de *liveness* (refund), nunca oportunidade de viés.

**Conclusão da seção:** aleatoriedade é solucionável, mas nenhuma opção é turnkey-nativa hoje, e o modelo de ameaça do sequencer único torna o "freeze-at-request" um requisito de arquitetura, não uma boa prática opcional.

### 4. Bloqueador crítico: NFTs & liquidez

**Não há pool de prêmios para lastrear.** O valor do FWA vem de NFTs de valor real (whitelist com CryptoPunks, BAYC, Milady, Azuki etc.). Na RH Chain:

- **Ecossistema NFT nativo é meme-tier:** OpenSea está integrado desde o launch, mas as coleções nativas (The Robin Hood, Robinhood Punks, Robinhood Kitties) não têm valor de mercado relevante (floors não quantificados nas fontes — **verificar dados atuais no OpenSea** antes de qualquer decisão de go-to-market). Um gacha lastreado nelas não tem proposta de valor.
- **Bridge de ERC-721 não existe como rota suportada:** o stack de bridging (canônica Arbitrum, LI.FI, Relay, Across, Stargate, CCIP) é todo ETH/ERC-20/stablecoin. A bridge canônica não tem rota trustless de ERC-721. Qualquer blue-chip trazida seria um *wrapped derivative* custodiado por bridge de terceiros — quebra a proposta "ganhe um CryptoPunk de verdade", fragmenta proveniência e adiciona risco de custódia.
- **Stock Tokens não são substituto:** são dívida tokenizada emitida pela Robinhood Assets (Jersey), gated jurisdicionalmente (indisponíveis nos EUA/UK/Canadá etc.) e fora do alcance de composição livre por terceiros — usar como prêmio de gacha seria regulatóriamente radioativo.

**Caminhos possíveis (todos degradam o produto):** (a) esperar/fomentar um ecossistema NFT nativo com valor — cronograma incontrolável; (b) gacha de wrapped-NFTs assumindo o risco de bridge; (c) pivotar o prêmio para ETH/USDG (a contabilidade core do FWA é collection-agnostic, então tecnicamente fácil) — mas aí o produto vira loteria de dinheiro puro, **agravando** o enquadramento de gambling da seção 5. Verificar também se existe algum bridge ERC-721 oficial planejado (docs de bridging da Robinhood).

### 5. Risco regulatório / ToS

- **Gambling:** o mecanismo pay-to-spin com prêmio de valor secundário e cash-out cumpre os três prongs do teste americano — *consideration* (ETH pago), *chance* (draw aleatório), *prize* (NFT com valor de mercado e liquidez de saída). O cash-out e o mercado secundário são exatamente os agravantes que tornam gacha cripto juridicamente mais arriscado que loot box de videogame. Não há estatuto federal de loot box; a exposição corre por consumer protection e leis estaduais de loteria — jurisdição-dependente e não resolvida. O branding "Fake World Assets" é ironia, não mitigação legal.
- **ToS da chain:** sem proibição explícita de gambling, mas o catch-all de "unlawful activity" cobre o caso, e a Robinhood se reserva o direito de bloquear wallets/endereços dos "Services". **Atenção:** o texto revisado é o ToS de testnet (10/02/2026) — **verificar o ToS de mainnet vigente**, que pode ter adicionado cláusulas explícitas anti-gambling.
- **Poder de execução real, não só contratual:** diferente do Ethereum mainnet onde o FWA vive, aqui a Robinhood opera o sequencer (com screening de compliance já documentado para endereços sancionados) e o admin pode ligar allowlist de deploy. Uma corretora regulada tem forte incentivo reputacional a censurar um dApp gambling-adjacente na sua própria chain. Verificar se existe force-inclusion via L1 (padrão Arbitrum) como rota de resistência à censura — provável, mas não confirmado nas fontes para esta chain.
- **Precedente do operador:** vale checar se a Robinhood publicou qualquer política sobre dApps de consumo de terceiros — nenhuma declaração foi encontrada.

### 6. Matriz de riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| Ausência de VRF nativo (Chainlink VRF não deployado na chain) | Alta | VRF via CCIP↔Arbitrum One hoje; em paralelo, onboarding de Pyth Entropy/Supra dVRF; medir latência/custo do round-trip na testnet |
| Manipulação de estado entre request e callback (vetor do exploit real do FWA, agravado pelo sequencer único) | Alta | Snapshot de preço/pesos/posições no request; escrow no request; FIFO ordem-invariante; callback mínimo + settle separado; refunds pull-based |
| Inexistência de NFTs de valor na chain + ausência de bridge ERC-721 | Alta | Pivotar prêmios para ETH/USDG ou aceitar wrapped-NFTs com disclosure; monitorar surgimento de bridge ERC-721 oficial e de coleções nativas com floor real |
| Enquadramento como gambling (consideration + chance + prize com cash-out) | Alta | Parecer jurídico por jurisdição; geofencing/bloqueio de jurisdições hostis; divulgação de odds on-chain; sem marketing a menores; avaliar estruturas sem cash-out |
| Censura pelo sequencer / bloqueio de wallets via ToS pela Robinhood | Alta | Confirmar mecanismo de force-inclusion via L1; plano de contingência multi-chain; engajamento prévio com a Robinhood antes do launch |
| Ativação futura do allowlist de deployers / upgrade sem delay pelo admin (não é Stage 1) | Média | Deploy antecipado (contratos existentes sobrevivem a allowlist de *novos* deploys — confirmar semântica); monitorar governança do Security Council; rota de saída via bridge canônica |
| Front-running/timing de callback pelo sequencer (MEV de operador único) | Média | Reveal delay; provedor cujo segredo só é revelado pós-finalização do request; retenção de callback = liveness failure com refund, nunca viés |
| Uniswap v4/PoolManager pode não existir na chain (quebra FWATokenHook) | Média | Confirmar no Blockscout/docs; fallback: ERC-20 com fee e gating próprios, sem hook v4 |
| Seleção adversa econômica (pool converge para floor; posições leves drenadas) | Média | Manter peso inverso ao backing + surcharge do FWA; curadoria de whitelist; fee premium para dinâmicas targeted (padrão NFTX ~5%) |
| DoS de settlement via hooks `onERC721Received` / callback revertendo | Média | `transferFrom` simples ou claim escrow pull-based; `recoverStuckNFT`; nonReentrant + checks-effects-interactions |
| Divergências Nitro (block.number = L1, gás em 2 partes) quebrando janelas/timeouts | Baixa | Usar `ArbSys.arbBlockNumber()` e timestamps; testes de integração na testnet 46630 |
| Ausência de subgraph/indexação confirmada | Baixa | APIs do Blockscout + Alchemy enhanced APIs; confirmar suporte do The Graph |
| ArbOS version desconhecida da chain (compatibilidade de opcodes/precompiles) | Baixa | Confirmar versão via RPC/full node docs; smoke tests na testnet antes do mainnet |

---

**Verificações obrigatórias antes de qualquer commit de engenharia:** (1) ToS de mainnet vigente; (2) presença de Pyth Entropy/Supra/Gelato na chainId 4663; (3) existência de Uniswap v4 PoolManager na chain; (4) mecanismo de force-inclusion L1; (5) custo/latência real do round-trip CCIP+VRF na testnet (chainId 46630, faucet https://faucet.testnet.chain.robinhood.com); (6) floors reais das coleções NFT nativas no OpenSea.

---

## Parte 4 — Plano de desenvolvimento com Claude Code

**Codinome do produto: "Aljava Protocol"** · Executado com Claude Code · Base: chainId 4663 (mainnet) / 46630 (testnet)

---

### 1. Visão do produto

**Aljava** é um protocolo de liquidez gamificada para a RobinhoodChain: depositantes travam uma *posição* (um NFT nativo da chain **ou** uma posição sintética de valor puro em USDG/ETH — "cofres") junto com backing em USDG que financia um bid de recompra permanente; compradores pagam um preço derivado do pool (média harmônica dos backings + surcharge) para adquirir **uma posição aleatória verificável**, podendo ficar com o ativo ou aceitar o bid. Como a RH Chain não tem NFTs blue-chip nem bridge ERC-721, o produto pivota o lastro para o que a chain *tem de sobra* — USDG (stablecoin nativa) e ETH (gas token) — e trata NFTs nativos como camada opcional/curada, posicionando-se como "mercado de liquidez instantânea para posições tokenizadas", não como loteria. *Stock Tokens ficam explicitamente fora do escopo v1 (radioativos regulatoriamente); a arquitetura collection-agnostic deixa a porta aberta caso composição de terceiros seja liberada no futuro.*

---

### 2. Arquitetura de contratos

Todos em Solidity ≥0.8.26, deploy via Foundry, aproveitando o code size de 96 KB do Nitro (core pode ser monolítico, sem diamond pattern).

| Contrato | Responsabilidade | Estado-chave |
|---|---|---|
| **`AljavaFactory`** | Deploy permissionless de pools via clones EIP-1167; registro de pools; config global (surcharge default, cuts, janelas) | `mapping(address collection => address pool)`, `allPools[]`, `defaultConfig` |
| **`AljavaPool`** (core) | Registro de posições (ativo + backing USDG), pesos inversos (`1e36/backing`), pricing por média harmônica + surcharge, fila FIFO de draws, máquina de estados de settlement (keep / relist / aceitar bid / bid-em-token), refunds pull-based, crown/tithe (opcional v2) | `positions[id] {asset, tokenId, backing, depositor, weight}`, `totalWeight`, `weightedBackingTotal`, **`drawQueue[] {buyer, priceSnapshot, totalWeightSnapshot, positionSetRoot, escrowedPayment, state}`**, `refundCredit[addr]`, `nextSettleIndex` |
| **`RandomnessRouter`** | Abstração de aleatoriedade: interface única `requestRandom(drawId) → fulfill(drawId, word)`; roteia para o adapter ativo; **callback mínimo (só grava a word)**; `settle()` separada e pública; timeout ⇒ refund | `pendingRequests[drawId]`, `activeAdapter`, `requestDeadline[drawId]` (via `ArbSys.arbBlockNumber()` + timestamp) |
| **`CCIPVRFAdapter`** (RH Chain) + **`VRFRequester`** (Arbitrum One) | Leg 1: envia mensagem CCIP à Arbitrum One; `VRFRequester` consome VRF v2.5 (coordinator `0x3C0Ca6...a3e`) e devolve a random word via CCIP; leg 2: recebe e entrega ao Router | `ccipRouter`, `destChainSelector`, `vrfSubId`, `keyHash`, mapa `ccipMessageId ↔ drawId` |
| **`EntropyAdapter`** (fallback/futuro) | Consumer `IEntropy` da Pyth Entropy caso a Pyth faça onboarding da chainId 4663 | `entropyContract`, `provider`, `userCommitments` |
| **`FenwickTree`** (library) | Seleção ponderada O(log n): prefix-sum + binary search sobre pesos; lazy-delete de posições vencidas | árvore em storage do Pool |
| **`AljavaToken`** (ERC-20 $ALJ) | Token de recompensa, supply fixo, mint restrito ao Emitter; **fee de 1% nativa no transfer para pares de DEX** (sem depender de hook v4 — ver gate da Fase 0) | `feeExemptSet`, `dexPairSet`, `feeWallet` |
| **`AljavaEmitter`** | Emissões estilo MasterChef: 15 dias, 1%/dia depositantes (acumulador √backing) + 1%/dia compradores (pote diário pro-rata) | `accTokenPerSqrt`, `depositorRatePerSec`, `dailyPots[day]`, `rewardDebt` |
| **`FeeRouter`** (Splitter) | Divide cuts de aquisição/settlement/trading entre tesouraria, depositantes e buyback (40/40/20 configurável); tudo pull-based | `shares[]`, `accrued[recipient]` |
| **`AljavaWhitelist`** | Curadoria de ativos aceitos (NFTs nativos + cofres USDG/ETH); sticky blocking (remoção não afeta posições existentes) | `allowedAssets`, `blockedSticky` |
| **`AljavaClaim`** | Distribuição Merkle-gated (snapshots, airdrops) | `merkleRoot`, `claimed` bitmap |

**Invariantes de design herdadas do exploit do FWA (obrigatórias, não opcionais):**
1. **Freeze-at-request:** preço, `totalWeight` e conjunto de posições são *snapshotados no request*; a random word é aplicada ao snapshot, nunca ao estado vivo. Depósitos/saídas durante um draw em voo entram numa fila e só se materializam após o settle.
2. Escrow do pagamento no request; settlement **FIFO estrito** (`settle(k)` só após `k-1`) e ordem-invariante.
3. `fulfillRandomWords`/handler CCIP jamais reverte e só grava a word; `settle()` é permissionless.
4. Callback atrasado/retido = falha de *liveness* ⇒ refund pull-based após deadline. Nunca oportunidade de viés.
5. Entrega de NFT via `transferFrom` simples ou claim-escrow (nunca `safeTransferFrom` push no settlement); `recoverStuckNFT`.
6. Nitro: janelas de 24h/7d por **timestamp**; timeouts de bloco via `ArbSys(0x64).arbBlockNumber()`; jamais `block.prevrandao`.

---

### 3. Escolha de aleatoriedade

**Recomendação primária (disponível hoje, zero BD): Chainlink VRF v2.5 cross-chain via CCIP.**

Fluxo request/callback:
1. `AljavaPool.startDraw()` → escrow do pagamento + snapshot → `RandomnessRouter.requestRandom(drawId)`.
2. `CCIPVRFAdapter` envia mensagem CCIP (RH Chain → Arbitrum One) com `drawId`, pagando fee em ETH/LINK.
3. `VRFRequester` (Arbitrum One) recebe via `ccipReceive`, chama `requestRandomWords` na subscription VRF (native payment, `requestConfirmations ≥ 3`).
4. `fulfillRandomWords` grava a word e dispara a mensagem CCIP de retorno com `(drawId, randomWord)`.
5. `CCIPVRFAdapter.ccipReceive` na RH Chain entrega ao Router, que **apenas armazena** a word.
6. Qualquer um chama `settle(drawId)` → Fenwick binary-search sobre o snapshot → transferência de posição + contabilidade.
7. Se a word não chegar até `requestDeadline` (a calibrar na Fase 0; chute inicial: 30 min), `expireDraw(drawId)` credita refund pull-based (fee de VRF/CCIP não reembolsável, fee de pool sim).

**Fallback / rota nativa alvo: Pyth Entropy** (commit-reveal duas partes, imparcial se qualquer parte for honesta, resultado em segundos). Não confirmada na chainId 4663 — abrir conversa de onboarding com a Pyth **em paralelo à Fase 0**. O `RandomnessRouter` com interface de adapter permite trocar CCIP-VRF → Entropy sem tocar no Pool. Terceira opção: Supra dVRF / Gelato VRF (ambos provados em Orbit, exigem BD). **Proibido:** `prevrandao` (constante =1 no Nitro), `blockhash` (sequencer único a 100ms), qualquer fallback pseudo-aleatório.

---

### 4. Stack & ferramentas

- **Smart contracts: Foundry** (não Hardhat) — fuzz/invariant tests nativos, `forge snapshot` para gás, fork tests contra RPC da RH Chain e da Arbitrum One (essencial para simular o round-trip CCIP com `vm.createSelectFork` em dois forks). Hardhat só se precisar de plugin específico de verificação (Blockscout aceita `forge verify-contract --verifier blockscout`).
- **Libraries:** OpenZeppelin 5.x (ERC-20/721, AccessControl, Merkle) + Solady (ReentrancyGuard, SafeTransferLib, LibClone p/ EIP-1167). Chainlink contracts (CCIP `Router`/`CCIPReceiver`, `VRFConsumerBaseV2Plus`).
- **Testes:** unit + fuzz (Foundry), invariant tests (invariantes da seção 2: soma de backings ≥ obrigações, FIFO, freeze-at-request), fork tests dual-chain, mutation testing leve (via prompts de review do Claude Code), Slither + Aderyn em CI.
- **Indexação:** The Graph **não confirmado** na chain ⇒ plano A: **Ponder** (self-hosted, funciona com qualquer RPC EVM, TypeScript, ótimo par com viem); plano B: APIs do Blockscout (`robinhoodchain.blockscout.com/api`) + Alchemy enhanced APIs. Verificar suporte do Graph como upside, não como dependência.
- **Frontend:** Next.js 15 (App Router) + wagmi v2 + viem + RainbowKit/ConnectKit. Definir chains custom no viem:
  - Mainnet: `id: 4663`, RPC `https://rpc.mainnet.chain.robinhood.com` (prod: Alchemy `robinhood-mainnet`), explorer Blockscout.
  - Testnet: `id: 46630`, RPC `https://rpc.testnet.chain.robinhood.com`, faucet `https://faucet.testnet.chain.robinhood.com` (+ faucets Chainlink/QuickNode/thirdweb).
- **Wallets:** MetaMask, Robinhood Wallet, WalletConnect; considerar ERC-4337 (nativo na chain) para UX de draw em 1 clique numa fase posterior.
- **CI/CD:** GitHub Actions — `forge fmt --check`, `forge test`, `forge snapshot --check`, Slither; deploy scripts em `forge script` com broadcast + verificação Blockscout automatizada.

---

### 5. Roadmap por fases

#### Fase 0 — Spike: validar chain + aleatoriedade (o gate mais importante)
**Objetivo:** provar na testnet 46630 que (a) deploy/verificação funcionam, (b) o round-trip CCIP↔VRF fecha com custo/latência aceitáveis, (c) os desvios Nitro estão mapeados.
**Entregáveis:**
- Repo Foundry inicializado com perfis para 4663/46630 e CI.
- Contrato `SpikeVRF`: par mínimo `CCIPVRFAdapter` (testnet RH) + `VRFRequester` (Arbitrum Sepolia), 20+ round-trips medidos (latência p50/p95, custo total em ETH por draw).
- Script de sondagem on-chain: existência de Pyth Entropy/Supra/Gelato na 4663/46630 (bytecode nos endereços canônicos), existência de Uniswap v4 `PoolManager`, versão de ArbOS via RPC, teste de `ArbSys.arbBlockNumber()` vs `block.number`.
- Checklist das 6 verificações obrigatórias da avaliação (ToS mainnet, Entropy, PoolManager, force-inclusion L1, custo CCIP+VRF, floors OpenSea) preenchido com evidência.
**Com Claude Code:** pedir para (1) fazer scaffold do repo Foundry multi-chain com os RPCs/chainIds; (2) escrever o par de contratos do spike + script `forge script` de deploy nas duas testnets; (3) escrever um script bash/TS que dispara N draws e coleta métricas de latência/custo do Blockscout; (4) escrever o script de sondagem de endereços canônicos (Entropy `0x52DeaA...`, PoolManager, precompiles).

#### Fase 1 — Contratos core + testes
**Objetivo:** `AljavaPool` + `RandomnessRouter` + `FenwickTree` + `Factory` + `Whitelist` completos, com as invariantes anti-exploit provadas por teste.
**Entregáveis:** contratos core; suíte com >90% branch coverage; **invariant tests** cobrindo: freeze-at-request (nenhuma mutação pós-request altera o resultado do draw k), FIFO, solvência por posição (ETH/USDG de uma posição nunca paga outra), refunds pull-based; fuzz do pricing harmônico (arredondamento/truncamento documentado); fork test dual-chain do fluxo completo; gas snapshot do `settle()` com n = 10/100/1.000/10.000 posições.
**Com Claude Code:** (1) gerar a spec formal (arquivo `SPEC.md` de invariantes) *antes* do código e pedir implementação contra a spec; (2) implementar o Fenwick com fuzz diferencial contra implementação de referência O(n); (3) pedir um **red-team review** dedicado reproduzindo o vetor do exploit de 03/07/2026 (mutação de estado entre request e fulfillment) como teste de ataque que deve falhar; (4) rodar Slither/Aderyn e triagem dos findings.

#### Fase 2 — Rewards & tokenomics
**Objetivo:** `AljavaToken` + `Emitter` + `FeeRouter` + `Claim`; decisão final sobre gating de transfer (hook v4 **somente se** o gate da Fase 0 confirmou PoolManager; caso contrário, fee nativa no ERC-20).
**Entregáveis:** emissões 15 dias (√backing + potes diários) com testes de precisão (escala 1e12/1e18, dedupe de pool, balance-delta p/ fee-on-transfer); buyback routing 40/40/20; simulação econômica off-chain (notebook/TS) de seleção adversa: convergência do pool ao floor sob pesos inversos, calibração de surcharge e premium targeted (~5% padrão NFTX).
**Com Claude Code:** (1) portar o padrão MasterChef com os pitfalls conhecidos como testes explícitos; (2) escrever o simulador econômico e iterar parâmetros; (3) review comparativo linha-a-linha contra os bugs históricos de MasterChef/NFTX listados na pesquisa.

#### Fase 3 — Frontend + indexação
**Objetivo:** dApp funcional na testnet: depositar, ver odds on-chain, comprar draw, acompanhar o round-trip CCIP (estado pendente!), settle, claim de refunds/rewards.
**Entregáveis:** app Next.js + wagmi/viem com as duas chains configuradas; indexer Ponder (posições, draws, settlements, fees) com API GraphQL; **UI de transparência**: odds por posição, EV, preço, e status do draw em voo (a latência de minutos do CCIP exige UX de "pending" honesta); página de disclosure de odds (mitigação consumer-protection).
**Com Claude Code:** (1) gerar hooks wagmi tipados a partir das ABIs (`wagmi cli`); (2) scaffold do schema Ponder a partir dos eventos dos contratos; (3) testes e2e com Playwright contra a testnet; (4) review de acessibilidade e de estados de erro (draw expirado, refund disponível).

#### Fase 4 — Auditoria + beta na testnet
**Objetivo:** hardening externo e prova social antes de qualquer valor real.
**Entregáveis:** pacote de auditoria (spec, invariantes, threat model com o sequencer único como ator adversarial explícito); auditoria externa (ou, no mínimo, contest tipo Code4rena/Cantina — o FWA original **não tinha auditoria publicada**, e foi dreanado; não repetir); beta público na 46630 com bug bounty pequeno; **parecer jurídico** sobre enquadramento gambling por jurisdição + implementação de geofencing/disclosures no frontend; contato formal com a Robinhood (BD/devrel) sobre postura para o dApp — antes do mainnet, não depois.
**Com Claude Code:** (1) gerar o threat model estruturado (STRIDE sobre cada função externa); (2) preparar o pacote de auditoria e responder findings com PRs testados; (3) escrever monitores/alertas (script que observa draws em voo e latência de callback, alerta se p95 estourar).

#### Fase 5 — Mainnet
**Objetivo:** launch controlado na 4663.
**Entregáveis:** deploy scripts idempotentes + verificação Blockscout; multisig (Safe, se disponível na chain — verificar; senão timelock próprio) como owner; **launch guarded**: caps de backing/draw por época, fase de loading (aquisições desligadas até o pool estar estocado), pause granular; runbook de incidente (modelo withdraw-only do FWA como último recurso, já implementado e testado); monitoramento 24/7 dos adapters de aleatoriedade; plano de contingência multi-chain documentado (risco de censura/allowlist).
**Com Claude Code:** (1) dry-run completo do deploy em fork da mainnet; (2) gerar o runbook e os scripts de emergência (pause, migração de adapter, withdraw-only) com testes; (3) checklist final de diffs entre bytecode auditado e deployado.

---

### 6. Marcos de validação / gates (go/no-go)

| Gate | Critério de passagem | Se falhar |
|---|---|---|
| **G0 (fim da Fase 0) — o gate que decide tudo** | Round-trip CCIP+VRF na testnet com **p95 ≤ 10 min e custo ≤ ~US$ 2–3/draw** (a calibrar vs. ticket médio); deploy/verify funcionando; ToS mainnet revisado sem cláusula anti-gambling explícita; nenhum bloqueio de deploy observado | Se custo/latência inviáveis **e** Pyth/Supra/Gelato recusarem onboarding: **parar** — sem aleatoriedade verificável não há produto. Se ToS proibir: parar ou pivotar de chain |
| **G1** | Invariant tests verdes incl. reprodução do vetor do exploit FWA falhando como ataque; coverage >90%; zero findings high do Slither sem justificativa | Não avançar para tokenomics com core furado |
| **G2** | Simulação econômica não mostra drenagem trivial (pool não converge a floor em <30 dias sob agentes racionais); precisão de rewards com erro < 1 wei/1e12 | Recalibrar surcharge/pesos antes do frontend |
| **G3** | Fluxo e2e completo na testnet por usuários externos; indexer sem gaps em 1 semana | Corrigir antes de gastar com auditoria |
| **G4** | Auditoria sem highs abertos; parecer jurídico entregue com estratégia de jurisdições; resposta (ou silêncio documentado) da Robinhood | Highs abertos = sem mainnet. Sinal hostil da Robinhood = reavaliar chain |
| **G5** | 2 semanas de mainnet guarded sem incidentes ⇒ levantar caps gradualmente | Qualquer anomalia de callback ⇒ pause + investigação |

---

### 7. Estimativa de esforço

Assumindo 1–2 devs sêniores pareando com Claude Code:

| Fase | Estimativa | Observação |
|---|---|---|
| Fase 0 | 1–2 semanas | Maior parte é medição e verificações externas, não código |
| Fase 1 | 3–4 semanas | O freeze-at-request + FIFO + Fenwick é o coração; não apressar |
| Fase 2 | 2–3 semanas | +1 semana se hook v4 confirmado e adotado |
| Fase 3 | 2–3 semanas | Ponder acelera muito vs. subgraph incerto |
| Fase 4 | 4–8 semanas | Dominada pelo lead time de auditoria externa e parecer jurídico (paralelizáveis) |
| Fase 5 | 1–2 semanas + 2 de guarded launch | |
| **Total** | **~3,5–5,5 meses** | Caminho crítico: G0 e a auditoria |

---

### 8. Riscos abertos & próximos passos imediatos

**Riscos abertos (top 5, além da matriz da avaliação):**
1. G0 pode reprovar por custo/latência do CCIP — todo o resto depende disso; por isso a Fase 0 é minúscula e vem primeiro.
2. Robinhood pode ligar o allowlist de deployers ou censurar via sequencer a qualquer momento, sem delay — mitigação: deploy cedo, engajamento prévio, contingência multi-chain.
3. Enquadramento gambling **piora** com prêmios em USDG/ETH puro (loteria de dinheiro); o parecer jurídico da Fase 4 pode forçar redesign (ex.: sem cash-out direto, prêmios só-NFT) — manter a máquina de settlement parametrizável.
4. Onboarding da Pyth Entropy é incerto; sem ela, o produto vive permanentemente com latência de minutos.
5. Ecossistema NFT nativo pode nunca desenvolver valor ⇒ o produto fica dependente da narrativa "cofres" — validar apetite com o beta da Fase 4.

**3 ações concretas desta semana:**
1. **Rodar as verificações que não exigem código** (1 dia): ler o ToS de mainnet vigente; checar chainlist da Pyth Entropy e sondar bytecode nos endereços canônicos de Entropy/Supra/Gelato/PoolManager na 4663 via `cast code`; conferir floors das coleções nativas no OpenSea; confirmar force-inclusion L1 nos docs/L2BEAT.
2. **Iniciar o spike da Fase 0 com Claude Code** (2–3 dias): scaffold do repo Foundry dual-chain (46630 + Arbitrum Sepolia), pegar test ETH no faucet `https://faucet.testnet.chain.robinhood.com`, deployar o par `CCIPVRFAdapter`/`VRFRequester` e disparar os primeiros round-trips medidos.
3. **Abrir os dois canais de BD em paralelo** (assíncrono): e-mail/form de onboarding da Pyth Entropy para a chainId 4663, e contato com devrel da Robinhood Chain apresentando o protocolo (sem esconder a mecânica de sorteio) — a resposta deles é dado de G0/G4, e quanto antes chegar, mais barato é pivotar.

---

## Fontes principais

**FWA:** [fwa.fun](https://www.fwa.fun/) · [docs/overview](https://www.fwa.fun/docs/overview) · [roles](https://www.fwa.fun/docs/roles) · [pricing-draw](https://www.fwa.fun/docs/pricing-draw) · [prizes-odds](https://www.fwa.fun/docs/prizes-odds) · [winning](https://www.fwa.fun/docs/winning) · [fwa (token)](https://www.fwa.fun/docs/fwa) · [fees](https://www.fwa.fun/docs/fees) · [safety](https://www.fwa.fun/docs/safety) · [deployments](https://www.fwa.fun/docs/deployments) · [Exploit: Bankless Times 03/07/2026](https://www.banklesstimes.com/articles/2026/07/03/chainlink-callback-exploit-hits-tokenworks-cryptopunk-lost/) · [Comunicado TokenWorks](https://x.com/token_works/status/2080090785148457338)

**RobinhoodChain:** [docs.robinhood.com/chain](https://docs.robinhood.com/chain/) · [deploy-smart-contracts](https://docs.robinhood.com/chain/deploy-smart-contracts) · [differences-from-ethereum](https://docs.robinhood.com/chain/differences-from-ethereum/) · [protocol-contracts](https://docs.robinhood.com/chain/protocol-contracts/) · [bridging](https://docs.robinhood.com/chain/bridging/) · [terms-of-service](https://docs.robinhood.com/chain/terms-of-service) · [Arbitrum: mainnet](https://blog.arbitrum.io/robinhood-chain-mainnet/) · [Arbitrum: build your first dapp](https://blog.arbitrum.foundation/build-your-first-dapp-on-robinhood-chain/) · [Chainlink day-one (PR Newswire)](https://www.prnewswire.com/news-releases/robinhood-chain-launches-and-adopts-chainlink-to-unlock-access-to-the-onchain-economy-for-millions-of-users-302816242.html) · [OpenSea live](https://opensea.io/blog/articles/robinhood-chain-is-live-on-opensea) · [chainlist 4663](https://chainlist.org/chain/4663)

**Aleatoriedade:** [Chainlink VRF supported networks](https://docs.chain.link/vrf/v2-5/supported-networks) · [VRF security](https://docs.chain.link/vrf/v2-5/security) · [CCIP](https://docs.chain.link/ccip) · [Pyth Entropy](https://docs.pyth.network/entropy) · [Entropy chainlist](https://docs.pyth.network/entropy/chainlist) · [Gelato VRF](https://docs.gelato.cloud/developer-services/vrf/understanding-vrf) · [Supra dVRF (Arbitrum)](https://docs.arbitrum.io/for-devs/oracles/supra/supras-vrf) · [Arbitrum: sem RANDAO](https://research.arbitrum.io/t/randomness-please-bridge-block-difficulty-randao-op-code/7897) · [Sequencer](https://docs.arbitrum.io/how-arbitrum-works/deep-dives/sequencer)

**Arquitetura de referência:** [NFTX docs](https://docs.nftx.io/protocol-overview) · [NFTX v2](https://nftx.io/blog/an-introduction-to-nftx-v2) · [MasterChef](https://dev.to/heymarkkop/understanding-sushiswaps-masterchef-staking-rewards-1m6f) · [Reentrância ERC-721](https://ackee.xyz/blog/reentrancy-attack-in-erc-721/) · [Loot box / gambling (Pillar Legal)](https://www.pillarlegalpc.com/wp-content/uploads/2024/07/Pillar-Legal-Does-Your-Blockchain-Game-Lootbox-Constitute-Gambling-2023-6-12.pdf)

---

*Documento gerado por análise multi-agente (7 agentes: 5 pesquisas paralelas + síntese de viabilidade + plano) com Claude Code.*
