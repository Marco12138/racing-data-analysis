import assert from "node:assert/strict";
import { test } from "node:test";
import { comparisonStart, comparisonVideoKey, parseVideoComparisons, seekComparisonVideo } from "../frontend/lib/videoComparison.ts";

test("manual starts retain uncertainty and always end five seconds later", () => {
  const start = comparisonStart(159.55, 300);
  assert.deepEqual(start, { start_s:159.55, end_s:164.55, uncertainty_s:.5, method:"manual_start_plus_five_v1" });
  for (const [time, duration] of [[-1,20],[16,20],[NaN,20],[0,Infinity],[0,4]]) assert.equal(comparisonStart(time,duration),null);
  assert.equal(comparisonStart(15,20).end_s,20);
});

test("saved comparisons stay bound to both files and validate every manual start", () => {
  const row = {version:1,id:"review",pair_key:"a|b",name:"Right turn",drivers:["A","B"],starts:[comparisonStart(1,20),comparisonStart(4,30)],same_location_confirmed:true};
  const parse = value => parseVideoComparisons(JSON.stringify([value]),"a|b",[20,30]);
  assert.equal(parse(row).length,1);
  for (const patch of [{pair_key:"a|c"},{same_location_confirmed:false},{drivers:["A"]},{starts:[comparisonStart(1,20),{...comparisonStart(4,30),uncertainty_s:0}]},
    {starts:[comparisonStart(1,20),{...comparisonStart(4,30),end_s:10}]},{starts:[comparisonStart(1,20),comparisonStart(100,200)]}]) assert.equal(parse({...row,...patch}).length,0);
  assert.equal(parseVideoComparisons("bad JSON","a|b",[20,30]).length,0);
  assert.equal(parseVideoComparisons(JSON.stringify(Array(12).fill(row)),"a|b",[20,30]).length,10);
  assert.equal(row.starts[0].start_s,1);
});

test("local sampled identity distinguishes different bytes without retaining filenames", async () => {
  const one=new File(["private-video-one"],"private-name.mp4"), two=new File(["private-video-two"],"private-name.mp4");
  const a=await comparisonVideoKey(one), b=await comparisonVideoKey(two);
  assert.notEqual(a,b); assert.doesNotMatch(a,/private/);
  assert.equal(a,await comparisonVideoKey(new File(["private-video-one"],"renamed.mp4")));
});

test("canceled playback never seeks or modifies the manual start", async () => {
  const controller=new AbortController(); controller.abort();
  const video={currentTime:20,readyState:2,seeking:false};
  await assert.rejects(seekComparisonVideo(video,1,controller.signal));
  assert.equal(video.currentTime,20);
  await seekComparisonVideo(video,20,new AbortController().signal);
});
