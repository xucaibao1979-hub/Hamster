import test from 'node:test';
import assert from 'node:assert/strict';
import {holderStatusChanges} from '../deploy/repair-holder-status.mjs';

test('只修正实际领用人非空且状态不是使用中的资产',()=>{
 const assets=[
  {number:'A',holder:'测试员工甲',status:'闲置'},
  {number:'B',holder:'  张三  ',status:'损坏'},
  {number:'C',holder:'已报废',status:'闲置'},
  {number:'D',holder:'未使用',status:'闲置'},
  {number:'E',holder:'闲置',status:'闲置'},
  {number:'F',holder:'',status:'闲置'},
  {number:'G',holder:'李四',status:'使用中'},
 ];
 assert.deepEqual(holderStatusChanges({assets}).map(a=>a.number),['A','B']);
});

