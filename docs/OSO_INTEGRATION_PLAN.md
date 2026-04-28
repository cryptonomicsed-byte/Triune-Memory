# OsO Integration Plan

## Hook Points
- birth -> triune.birth(agentId,name)
- think -> triune.write(agentId,'think',text,'private'|'public')
- act -> triune.write(agentId,'act',tool+params,'public'|'private',tool,params)

## Receipt Unification
- include triune receipt refs inside OsO interpreter receipts.

## Recovery
- replay commitments from Sui and hydrate blobs from Walrus.
