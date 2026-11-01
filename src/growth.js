// Growth (step 5): the Elder Tree's 8 levels in 5 STAGES (Sapling -> Young -> Grown -> Great -> Elder), what each level
// opens, and the "tree memory" story card of each level (shown on level-up and in the Book). Pure data + helpers; the
// numbers live where they act (Sim.C.LV_XP / SCALE, Sim.C.B[type].lv, Exped.DEST[i].lv, Exped.maxTrips, nav plot lv).
// sim_check proves the lists below match those numbers ("unlocks at the right levels").
// Pacing (Sim.C.LV_XP, xp/h = 3 x (health - 40)): ~20 min to L2, ~3 h to L3, L4 on day 2, Elder after ~2-4 weeks of normal
// play (sim_check prints the table + a 30-day "normal player" run).
(function () {
  'use strict';
  const STAGES = [
    // the look of each stage is drawn by tree_fx.js (tree growth: ST table); the blurbs describe it
    { name: 'Sapling', from: 1, blurb: 'a slim sapling with a few leaves and glowing veins' },
    { name: 'Young', from: 3, blurb: 'a thin young trunk, its first branches and glowing fruit' },
    { name: 'Grown', from: 5, blurb: 'a full canopy, layer on layer, fruit in every branch' },
    { name: 'Great', from: 7, blurb: 'spreading roots, the first hanging lanterns, glow motes rising' },
    { name: 'Elder', from: 8, blurb: 'the towering Elder Tree of the old stories, lantern-hung and in full glow' },
  ];
  const stageOf = lv => { let k = 0; for (let i = 0; i < STAGES.length; i++) if (lv >= STAGES[i].from) k = i; return k; };
  // what each level opens (UI text; icon keys are game.js IC names)
  const UNLOCKS = {
    1: [['home', 'Cottages, gardens, woodsheds, stone piles, lantern paths'], ['paw', 'Strays cross the bridges when there are free beds']],
    2: [['board', 'Expedition dock'], ['stage', 'Music stage'], ['isle', 'Sky trips: Mossy Isle + Lantern Rock'], ['home', 'The second ring of land (to 250 m)']],
    3: [['conserv', 'Conservatory'], ['home', 'Treehouses'], ['board', 'A second sky boat'], ['isle', 'Cloud Perch + Sunken Hollow']],
    4: [['protect', 'Hush Hall (guardian hall)'], ['sprout', 'Sprout House (school)'], ['cart', 'Market square'], ['isle', 'Far Spires'], ['wood', 'The outer woods grow back']],
    5: [['nourish', 'Greenhold (the great conservatory)'], ['spirit', 'Circus'], ['isle', 'Starfall Isles'], ['home', 'The outer ring of land (past 260 m)']],
    6: [['build', 'Gale Forge (tools + crafting)'], ['isle', 'Ember Reach'], ['board', 'A third sky boat'], ['wood', 'The middle woods grow back']],
    7: [['fruit', 'Glowing fruit falls twice as often'], ['orb', 'Glow motes rise from the canopy'], ['star', 'Spreading roots + the first hanging lanterns']],
    8: [['sap', 'Elder glow: +25 % glow sap'], ['star', 'The full-size Elder Tree, taller than ever, hung with lanterns']],
  };
  // tree memories: one per level, short + cozy (the tree remembers)
  const MEMORIES = {
    1: { title: 'The First Root', text: 'A single glowing seed once fell from the stars and landed here. Six sleepy pups found it, gave it a drink, and decided to stay. That was the start of everything.' },
    2: { title: 'Little Leaves', text: 'The first real leaves opened at dawn. Pudding swears one of them waved at her. Far away, the floating isles drifted a little closer to have a look.' },
    3: { title: 'Too Wide to Hug', text: 'The trunk is too wide now for one pup to hug all the way round. So they hug it three at a time, and the tree hums.' },
    4: { title: 'The Old Halls', text: 'From its new branches the tree can see the old halls in the woods: Hush Hall, the Sprout House, the market square. Long empty, they look ready to wake up.' },
    5: { title: 'Nests and Lanterns', text: 'Birds nest in the canopy now. At night the veins glow so brightly that a pup on the farthest bridge can find the way home without a lantern.' },
    6: { title: 'The Gale Song', text: 'Wind chimes ring from the Gale Forge cliffs again. The old smiths tuned their bells to the sound of these leaves, and the tree remembers every note.' },
    7: { title: 'Golden Boughs', text: 'The boughs hang heavy with golden fruit. The tree has watched the seasons turn many times now, and it hums softly through every one of them.' },
    8: { title: 'The Elder Tree', text: 'The tree stands as tall as in the oldest stories, and the whole island glows with it. In its slow tree way, it is grateful for every bucket, every lantern and every song.' },
  };
  window.Growth = { STAGES, stageOf, UNLOCKS, MEMORIES, stageName: lv => STAGES[stageOf(lv)].name };
})();
