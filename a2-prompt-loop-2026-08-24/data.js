window.EXPERIMENT = {
  updated: "2026-08-24 05:10 KST",
  rounds: [
    {
      id: 1,
      label: "Baseline",
      status: "complete",
      started: "00:57",
      completed: "01:08",
      score: 80.2,
      identity: 26.7,
      passRate: 80.0,
      hardFails: 3,
      ssim: 0.956,
      change: "입력 역할을 1=고정 배경, 2=공간 참고, 3=유일한 정체성으로 선언.",
      finding: "강한 고유 특징은 보존했지만 Nala 두 입력에서 Image 2의 태비 고양이가 반복 복제됨. 모든 출력이 941×1672로 배경을 재생성함.",
      diff: "+ strict image roles"
    },
    {
      id: 2,
      label: "Identity first",
      status: "complete",
      started: "02:57",
      completed: "03:07",
      score: 81.0,
      identity: 27.1,
      passRate: 80.0,
      hardFails: 3,
      ssim: 0.961,
      change: "Image 3에서 Identity Spec을 먼저 만들고, Image 2는 외형 픽셀을 폐기하는 layout map으로만 사용.",
      finding: "평균 Identity는 +0.4점에 그쳤고 Hard Fail은 3건으로 동일. Nala 2장과 광각 주황 고양이의 정체성 붕괴가 반복됨.",
      diff: "+ identity-first reasoning"
    },
    {
      id: 3,
      label: "Identity capsule",
      status: "complete",
      started: "04:57",
      completed: "05:06",
      score: 87.5,
      identity: 30.7,
      passRate: 86.7,
      hardFails: 2,
      ssim: 0.963,
      change: "각 사용자 사진에서 사람이 검증한 한 줄 Identity Capsule을 명시적으로 주입.",
      finding: "Identity +4.0점, Hard Fail 3→2. 체형·표정·광각 얼굴은 개선됐지만 Nala 두 입력은 공간 참조 골격이 남음.",
      diff: "+ external identity capsule"
    }
  ],
  samples: [
    {id:"RC-CAT-001",name:"Nala / occluded",tags:["costume occlusion","paired"],r1:{total:50,identity:12,ssim:.922444,fail:true,note:"태비 레퍼런스 정체성이 사용자 고양이보다 강하게 복제됨."},r2:{total:57,identity:14,ssim:.956193,fail:true,note:"색은 가까워졌지만 큰 눈과 Nala 얼굴은 여전히 공간 레퍼런스 쪽으로 붕괴."},r3:{total:74,identity:23,ssim:.966396,fail:true,note:"큰 눈과 둥근 얼굴은 개선됐지만 공간 레퍼런스의 얼굴·체형 골격이 여전히 우세."}},
    {id:"RC-CAT-005",name:"Coffee",tags:["white","blue eyes"],r1:{total:87,identity:30,ssim:.965652,fail:false,note:"흰 털·파란 눈·둥근 얼굴이 안정적으로 보존됨."},r2:{total:88,identity:31,ssim:.967934,fail:false,note:"흰 털·선명한 파란 눈·작고 둥근 얼굴이 강하게 보존됨."},r3:{total:90,identity:32,ssim:.954693,fail:false,note:"선명한 파란 눈·순백 털·작고 둥근 얼굴이 강하게 보존됨."}},
    {id:"RC-CAT-018",name:"Venus",tags:["split face","heterochromia"],r1:{total:92,identity:33,ssim:.954940,fail:false,note:"분할 얼굴과 오드아이가 가장 강하게 보존된 성공 사례."},r2:{total:93,identity:34,ssim:.970127,fail:false,note:"분할 얼굴색과 오드아이가 거의 완전하게 보존된 최고 성공 사례."},r3:{total:94,identity:34,ssim:.969833,fail:false,note:"정확한 반반 얼굴·오드아이·토터셸 분포가 가장 강하게 보존됨."}},
    {id:"RC-CAT-028",name:"Luna",tags:["folded ears","occlusion"],r1:{total:84,identity:29,ssim:.964708,fail:false,note:"접힌 귀와 얼굴은 유지됐으나 털 무늬가 단순화됨."},r2:{total:84,identity:29,ssim:.963727,fail:false,note:"접힌 귀와 다색 얼굴은 유지됐지만 세부 털 무늬는 단순화."},r3:{total:87,identity:31,ssim:.954327,fail:false,note:"접힌 귀·둥근 얼굴·다색의 복슬한 털이 이전보다 명시적으로 살아남."}},
    {id:"RC-CAT-036",name:"Coby",tags:["white","clothing"],r1:{total:87,identity:30,ssim:.952860,fail:false,note:"옷은 제거되고 흰 털·파란 눈·얼굴 비율은 유지됨."},r2:{total:86,identity:30,ssim:.941563,fail:false,note:"흰 털·파란 눈·작은 얼굴은 유지됐지만 배경 편차가 커짐."},r3:{total:90,identity:31,ssim:.974165,fail:false,note:"파란 눈·순백 털·작은 얼굴 비율이 안정적으로 보존됨."}},
    {id:"RC-CAT-049",name:"Smoothie",tags:["long fur","golden"],r1:{total:87,identity:31,ssim:.954191,fail:false,note:"긴 황금 털과 초록 눈이 잘 보존됨."},r2:{total:86,identity:31,ssim:.951596,fail:false,note:"긴 황금 털과 초록 눈의 정체성은 계속 강하게 유지됨."},r3:{total:91,identity:33,ssim:.962147,fail:false,note:"긴 황금 털·초록 눈·풍성한 볼털·깃털 같은 꼬리가 모두 보존됨."}},
    {id:"RC-CAT-065",name:"Pudge",tags:["calico","flat face"],r1:{total:89,identity:31,ssim:.962609,fail:false,note:"납작한 얼굴·작은 체형·칼리코 분포가 유지됨."},r2:{total:89,identity:31,ssim:.968457,fail:false,note:"납작한 얼굴·칼리코 분포·작은 체형이 안정적으로 보존됨."},r3:{total:92,identity:33,ssim:.966925,fail:false,note:"납작한 주둥이·작은 체형·검정-주황-흰 얼굴 패치가 강하게 보존됨."}},
    {id:"RC-CAT-066",name:"Hamilton",tags:["mustache","bicolor"],r1:{total:88,identity:30,ssim:.970945,fail:false,note:"콧수염 무늬는 강하나 체형이 레퍼런스 쪽으로 평준화됨."},r2:{total:86,identity:30,ssim:.954495,fail:false,note:"콧수염 무늬와 얼굴 각도는 유지됐지만 몸은 평준화됨."},r3:{total:90,identity:32,ssim:.959775,fail:false,note:"검은 콧수염·흰 가슴·회색 둥근 얼굴이 명확하고 안정적임."}},
    {id:"RC-CAT-081",name:"Bronson",tags:["large body","orange"],r1:{total:81,identity:27,ssim:.964048,fail:false,note:"찡그린 눈과 주황 털은 유지됐지만 큰 체형이 축소됨."},r2:{total:85,identity:29,ssim:.968317,fail:false,note:"큰 누운 체형과 찡그린 표정이 1차보다 좋아짐."},r3:{total:91,identity:33,ssim:.965265,fail:false,note:"무거운 큰 체형·누운 자세·작게 찡그린 눈이 강하게 회복됨."}},
    {id:"RC-CAT-092",name:"Rexie",tags:["smile","tabby"],r1:{total:87,identity:31,ssim:.932230,fail:false,note:"웃는 입·이빨·갈색-흰색 얼굴이 강하게 보존됨."},r2:{total:89,identity:32,ssim:.957366,fail:false,note:"특유의 웃는 입과 작은 이빨·갈색-흰색 얼굴을 강하게 보존."},r3:{total:91,identity:33,ssim:.957033,fail:false,note:"벌어진 웃는 입·보이는 이빨·넓은 흰 주둥이가 강한 개체 인상을 만듦."}},
    {id:"RC-CAT-105",name:"Suki",tags:["spotted","large ears"],r1:{total:78,identity:26,ssim:.957720,fail:false,note:"벵갈 무늬는 유지됐지만 얼굴이 일반화됨."},r2:{total:76,identity:25,ssim:.959045,fail:false,note:"벵갈 무늬는 남았지만 얼굴이 일반적인 벵갈로 평준화됨."},r3:{total:86,identity:30,ssim:.950967,fail:false,note:"큰 귀·날씬한 체형·옅은 눈·벵갈 로제트가 일반화를 줄임."}},
    {id:"CZ-CAT-006",name:"Zelda",tags:["tuxedo","slender"],r1:{total:84,identity:28,ssim:.954852,fail:false,note:"턱시도 무늬·큰 눈은 유지됐으나 날씬한 체형이 사라짐."},r2:{total:86,identity:29,ssim:.964732,fail:false,note:"턱시도 마스크·큰 눈·흰 가슴과 날씬한 몸이 더 잘 보존됨."},r3:{total:91,identity:32,ssim:.973513,fail:false,note:"큰 눈·턱시도 마스크·좁은 흰 블레이즈·날씬한 몸이 보존됨."}},
    {id:"RC-CAT-117",name:"Cole & Marmalade",tags:["orange-white","crossed paws"],r1:{total:82,identity:27,ssim:.955295,fail:false,note:"얼굴은 유지됐지만 긴 교차 앞발 특징이 사라짐."},r2:{total:79,identity:26,ssim:.960281,fail:false,note:"주황-흰색 얼굴은 남았지만 긴 교차 앞발은 재현되지 않음."},r3:{total:87,identity:31,ssim:.961206,fail:false,note:"긴 앞발 한쪽을 앞으로 교차한 자세와 날씬한 주황-흰 정체성이 회복됨."}},
    {id:"RC-CAT-126",name:"Cat Photographer",tags:["wide angle","wet fur"],r1:{total:68,identity:20,ssim:.960658,fail:true,note:"근접 원근 얼굴이 일반적인 주황 고양이로 붕괴됨."},r2:{total:66,identity:19,ssim:.968181,fail:true,note:"큰 눈·광각 주둥이·젖은 털이 다시 일반 주황 고양이로 붕괴."},r3:{total:84,identity:29,ssim:.968083,fail:false,note:"큰 눈·앞으로 나온 주둥이·젖은 털과 물방울이 회복돼 처음 Hard Fail 탈출."}},
    {id:"RC-CAT-003",name:"Nala / natural",tags:["natural light","paired"],r1:{total:59,identity:15,ssim:.962308,fail:true,note:"다른 Nala 입력도 반복해서 태비 레퍼런스 고양이로 변함."},r2:{total:65,identity:17,ssim:.962746,fail:true,note:"은색 털은 맞지만 둥근 얼굴·큰 눈은 공간 레퍼런스 쪽으로 평준화."},r3:{total:74,identity:23,ssim:.957547,fail:true,note:"둥근 눈과 복슬한 체형은 개선됐지만 Nala보다 공간 레퍼런스에 더 가까움."}}
  ]
};
