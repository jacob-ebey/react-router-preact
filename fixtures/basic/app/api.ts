"use server";

let mutations = 0;

export function getMutations() {
	return mutations;
}

export function incrementMutations() {
	mutations++;
}
