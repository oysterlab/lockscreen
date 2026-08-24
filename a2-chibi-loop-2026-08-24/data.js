window.EXPERIMENT = {
  updated: "2026-08-24 12:48 KST",
  productStatus: "OWNER REVIEW REQUIRED",
  rounds: [
    {id:1,status:"complete",started:"08:35",completed:"08:47",label:"Manifest baseline",machine:"15 / 15",generated:15,change:"입력 역할과 개체·액세서리 manifest를 명시적으로 고정.",finding:"모든 기술 게이트와 필수 물건의 시각적 사전 점검은 통과. 다만 여러 결과가 비슷한 둥근 두상·눈·몸 템플릿으로 평준화될 위험이 남았다.",diff:"+ role labels + manifests"},
    {id:2,status:"complete",started:"10:36",completed:"10:50",label:"Identity firewall",machine:"13 / 15",generated:15,change:"골든 고양이의 두상·눈·주둥이·무늬·체형 정체성 전이를 금지.",finding:"최대 크기·배경 잠금은 15/15. 실제 실루엣 폭 기준은 13/15로, Venus와 Rexie가 권장 최소 폭보다 각각 0.02%p·0.85%p 작았다. 개별 표정과 포즈는 강해졌지만 일부가 자연스러운 실사형 고양이 쪽으로 기울었다.",diff:"+ anti-leak identity firewall"},
    {id:3,status:"complete",started:"12:36",completed:"12:48",label:"Tactile chibi",machine:"15 / 15",generated:15,change:"동일 개체 잠금을 유지하며 골든의 치비 조형과 촉감·표정 기준을 보강.",finding:"전체 세트의 플러시 질감·둥근 조형·짧은 팔다리가 2차보다 일관됐다. 주요 표정과 7개 필수 물건도 유지됐지만 Coby의 키가 큰 실루엣과 반복되는 눈·얼굴 재질은 사람 검토가 필요한 위험으로 남았다.",diff:"+ chibi affect / material"}
  ],
  geometry:[
    {label:"Silhouette width",value:"33.1–36.0%",note:"45장 전체 · hard max 40%"},
    {label:"Silhouette height",value:"19.0%",note:"hard max 20%"},
    {label:"Center X",value:"58.7–60.4%",note:"guide 55–63%"},
    {label:"Paw baseline",value:"85.2%",note:"guide 82–87%"},
    {label:"Canvas",value:"1080×1920",note:"45/45 exact"},
    {label:"Protected BG diff",value:"0 px",note:"45/45 exact"}
  ],
  gates:[
    {id:"G0",title:"Technical / Background",copy:"1080×1920, 한 마리, 금지 텍스트 없음, 허용 마스크 밖 배경 픽셀 차이 0."},
    {id:"G1",title:"Size / Placement",copy:"레퍼런스보다 커지지 않으며 상단 여백·중심·받침대 접지 범위를 모두 충족."},
    {id:"G2",title:"Chibi Style",copy:"전체 비율이 큰 둥근 머리·큰 눈·짧은 다리·낮은 몸의 고급 3D 플러시. 실사 비율 FAIL."},
    {id:"G3",title:"Same Individual",copy:"눈·두상·주둥이·귀·무늬 topology·털·체형 manifest 100%와 5인 blind retrieval."},
    {id:"G4",title:"Accessory Fidelity",copy:"필수 물건 recall 100%. 종류·색·패턴·위치·관계가 맞고 임의 추가가 없어야 함."},
    {id:"G5",title:"Cute / Touchable",copy:"5인 평가: 귀여움·만지고 싶음 평균 4.3 이상, 고급 촉감 평균 4.0 이상, 개별 최저 4."},
    {id:"G6",title:"Anatomy / Integration",copy:"중복 부위·융합·부유 없음. 왼쪽 채광, 받침대 접지, 액세서리 결합이 자연스러움."}
  ],
  samples:[
    {id:"RC-CAT-001",name:"Nala / shark",tags:["round eyes","tabby","costume"],accessory:"회색 니트 상어 후드·이빨·단추 눈·목 패널",note:"큰 눈·이마 M·볼 점·상어 후드 확인."},
    {id:"RC-CAT-005",name:"Coffee",tags:["white","blue eyes","collar"],accessory:"터키색 목걸이 + 보라색 COFFEE 태그",note:"눈색과 태그 글자까지 보존."},
    {id:"RC-CAT-018",name:"Venus",tags:["split face","heterochromia","tag"],accessory:"분홍 목걸이 + 하트형 Venus 태그",note:"좌우 얼굴색·오드아이·태그가 가장 명확."},
    {id:"RC-CAT-028",name:"Luna",tags:["folded ears","multicolour","fabric"],accessory:"몸과 머리를 감싼 회색 저지 천",note:"사람 영역 제거 크롭 후 고양이·천만 생성."},
    {id:"RC-CAT-036",name:"Coby",tags:["white","blue eyes","shirt"],accessory:"검정·흰색 깅엄 버튼 셔츠",note:"눈색·흰 털·셔츠 칼라와 단추 확인."},
    {id:"RC-CAT-049",name:"Smoothie",tags:["long fur","golden","green eyes"],accessory:"없음 — 임의 액세서리 금지",note:"긴 러프와 깃털 꼬리는 보이나 실사 질감 위험 검토 필요."},
    {id:"RC-CAT-065",name:"Pudge",tags:["calico","flat face","small"],accessory:"없음 — 임의 액세서리 금지",note:"납작한 얼굴과 칼리코 patch topology 확인."},
    {id:"RC-CAT-066",name:"Hamilton",tags:["moustache","grey-white"],accessory:"없음 — 임의 액세서리 금지",note:"코 아래 흰 콧수염 무늬가 핵심 retrieval 단서."},
    {id:"RC-CAT-081",name:"Bronson",tags:["heavy body","cream tabby","squint"],accessory:"없음 — 임의 액세서리 금지",note:"작게 찡그린 눈·무거운 몸·표정 보존."},
    {id:"RC-CAT-092",name:"Rexie",tags:["grin","teeth","tabby"],accessory:"없음 — 임의 액세서리 금지",note:"벌어진 웃는 입과 보이는 이빨이 유지됨."},
    {id:"RC-CAT-105",name:"Suki",tags:["Bengal","large ears","harness"],accessory:"빨강·검정 버펄로 체크 가슴 하네스/반다나",note:"로제트·큰 귀·체스트 액세서리 확인."},
    {id:"CZ-CAT-006",name:"Zelda",tags:["tuxedo","wide eyes","slender"],accessory:"없음 — 임의 액세서리 금지",note:"큰 눈·턱시도 mask·흰 bib가 보존되나 체형 평준화 검토."},
    {id:"RC-CAT-117",name:"Cole & Marmalade",tags:["orange-white","crossed paws"],accessory:"없음 — 임의 액세서리 금지",note:"긴 앞발 교차 포즈와 흰 가슴·주둥이 확인."},
    {id:"RC-CAT-126",name:"Wet orange",tags:["wide angle","wet fur","droplets"],accessory:"없음 — 물방울은 외형 조건",note:"큰 눈·앞으로 나온 주둥이·정수리 물방울 확인."},
    {id:"RC-CAT-003",name:"Nala / basket",tags:["silver","purple collar","basket"],accessory:"보라색 목걸이 + 얕은 베이지 직조 바구니",note:"목걸이와 고양이를 받치는 바구니가 함께 유지됨."}
  ]
};
