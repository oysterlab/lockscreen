window.EXPERIMENT = {
  updated: "2026-08-24 01:10 KST",
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
      status: "scheduled",
      started: "02:57",
      completed: null,
      score: null,
      identity: null,
      passRate: null,
      hardFails: null,
      ssim: null,
      change: "Image 3에서 Identity Spec을 먼저 만들고, Image 2는 외형 픽셀을 폐기하는 layout map으로만 사용.",
      finding: "Round 01의 reference identity leakage를 겨냥한 단일 변경.",
      diff: "+ identity-first reasoning"
    },
    {
      id: 3,
      label: "Final correction",
      status: "scheduled",
      started: "04:57",
      completed: null,
      score: null,
      identity: null,
      passRate: null,
      hardFails: null,
      ssim: null,
      change: "Round 02의 최대 실패 군집 하나를 확인한 뒤 확정.",
      finding: "대기 중.",
      diff: "pending"
    }
  ],
  samples: [
    {id:"RC-CAT-001",name:"Nala / occluded",tags:["costume occlusion","paired"],r1:{total:50,identity:12,ssim:.922444,fail:true,note:"태비 레퍼런스 정체성이 사용자 고양이보다 강하게 복제됨."}},
    {id:"RC-CAT-005",name:"Coffee",tags:["white","blue eyes"],r1:{total:87,identity:30,ssim:.965652,fail:false,note:"흰 털·파란 눈·둥근 얼굴이 안정적으로 보존됨."}},
    {id:"RC-CAT-018",name:"Venus",tags:["split face","heterochromia"],r1:{total:92,identity:33,ssim:.954940,fail:false,note:"분할 얼굴과 오드아이가 가장 강하게 보존된 성공 사례."}},
    {id:"RC-CAT-028",name:"Luna",tags:["folded ears","occlusion"],r1:{total:84,identity:29,ssim:.964708,fail:false,note:"접힌 귀와 얼굴은 유지됐으나 털 무늬가 단순화됨."}},
    {id:"RC-CAT-036",name:"Coby",tags:["white","clothing"],r1:{total:87,identity:30,ssim:.952860,fail:false,note:"옷은 제거되고 흰 털·파란 눈·얼굴 비율은 유지됨."}},
    {id:"RC-CAT-049",name:"Smoothie",tags:["long fur","golden"],r1:{total:87,identity:31,ssim:.954191,fail:false,note:"긴 황금 털과 초록 눈이 잘 보존됨."}},
    {id:"RC-CAT-065",name:"Pudge",tags:["calico","flat face"],r1:{total:89,identity:31,ssim:.962609,fail:false,note:"납작한 얼굴·작은 체형·칼리코 분포가 유지됨."}},
    {id:"RC-CAT-066",name:"Hamilton",tags:["mustache","bicolor"],r1:{total:88,identity:30,ssim:.970945,fail:false,note:"콧수염 무늬는 강하나 체형이 레퍼런스 쪽으로 평준화됨."}},
    {id:"RC-CAT-081",name:"Bronson",tags:["large body","orange"],r1:{total:81,identity:27,ssim:.964048,fail:false,note:"찡그린 눈과 주황 털은 유지됐지만 큰 체형이 축소됨."}},
    {id:"RC-CAT-092",name:"Rexie",tags:["smile","tabby"],r1:{total:87,identity:31,ssim:.932230,fail:false,note:"웃는 입·이빨·갈색-흰색 얼굴이 강하게 보존됨."}},
    {id:"RC-CAT-105",name:"Suki",tags:["spotted","large ears"],r1:{total:78,identity:26,ssim:.957720,fail:false,note:"벵갈 무늬는 유지됐지만 얼굴이 일반화됨."}},
    {id:"CZ-CAT-006",name:"Zelda",tags:["tuxedo","slender"],r1:{total:84,identity:28,ssim:.954852,fail:false,note:"턱시도 무늬·큰 눈은 유지됐으나 날씬한 체형이 사라짐."}},
    {id:"RC-CAT-117",name:"Cole & Marmalade",tags:["orange-white","crossed paws"],r1:{total:82,identity:27,ssim:.955295,fail:false,note:"얼굴은 유지됐지만 긴 교차 앞발 특징이 사라짐."}},
    {id:"RC-CAT-126",name:"Cat Photographer",tags:["wide angle","wet fur"],r1:{total:68,identity:20,ssim:.960658,fail:true,note:"근접 원근 얼굴이 일반적인 주황 고양이로 붕괴됨."}},
    {id:"RC-CAT-003",name:"Nala / natural",tags:["natural light","paired"],r1:{total:59,identity:15,ssim:.962308,fail:true,note:"다른 Nala 입력도 반복해서 태비 레퍼런스 고양이로 변함."}}
  ]
};

