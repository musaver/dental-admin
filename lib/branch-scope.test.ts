import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AuthError,
  canAccessBranch,
  resolveBranchScope,
  type BranchScopable,
} from './branch-scope.ts';

const headOffice: BranchScopable = { branchId: null, isHeadOffice: true };
const atMain: BranchScopable = { branchId: 'branch-main', isHeadOffice: false };

describe('resolveBranchScope — head office', () => {
  it('sees every branch when nothing is requested', () => {
    assert.equal(resolveBranchScope(headOffice, null).branchIds, null);
    assert.equal(resolveBranchScope(headOffice, undefined).branchIds, null);
  });

  it('treats "all" as every branch', () => {
    assert.equal(resolveBranchScope(headOffice, 'all').branchIds, null);
  });

  it('can narrow to a single branch', () => {
    const scope = resolveBranchScope(headOffice, 'branch-clifton');
    assert.deepEqual(scope.branchIds, ['branch-clifton']);
    assert.equal(scope.activeBranchId, 'branch-clifton');
  });
});

describe('resolveBranchScope — branch-scoped staff', () => {
  it('defaults to their own branch', () => {
    const scope = resolveBranchScope(atMain, null);
    assert.deepEqual(scope.branchIds, ['branch-main']);
    assert.equal(scope.activeBranchId, 'branch-main');
  });

  it('allows an explicit request for their own branch', () => {
    assert.deepEqual(resolveBranchScope(atMain, 'branch-main').branchIds, ['branch-main']);
  });

  it('collapses "all" to their own branch rather than granting everything', () => {
    assert.deepEqual(resolveBranchScope(atMain, 'all').branchIds, ['branch-main']);
  });

  it("refuses another branch outright, rather than returning an empty list", () => {
    // Silently returning nothing would hide the attempt and read like a bug.
    assert.throws(
      () => resolveBranchScope(atMain, 'branch-clifton'),
      (error: unknown) => error instanceof AuthError && error.status === 403
    );
  });

  it('refuses a contradictory context instead of guessing', () => {
    const broken: BranchScopable = { branchId: null, isHeadOffice: false };
    assert.throws(() => resolveBranchScope(broken, null), AuthError);
  });
});

describe('canAccessBranch', () => {
  it('lets head office reach any branch, including unassigned rows', () => {
    assert.equal(canAccessBranch(headOffice, 'branch-main'), true);
    assert.equal(canAccessBranch(headOffice, 'branch-clifton'), true);
    assert.equal(canAccessBranch(headOffice, null), true);
  });

  it('confines scoped staff to their own branch', () => {
    assert.equal(canAccessBranch(atMain, 'branch-main'), true);
    assert.equal(canAccessBranch(atMain, 'branch-clifton'), false);
  });

  it('denies a null branch to scoped staff', () => {
    // A row with no branch cannot be proven to belong to them.
    assert.equal(canAccessBranch(atMain, null), false);
  });
});
