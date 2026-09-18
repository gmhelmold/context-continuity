"""Independent test oracles. Never import the JavaScript renderer."""
from copy import deepcopy

def content_text(value):
    if value is None: return ''
    if isinstance(value, str): return value
    assert isinstance(value, list) and all(p.get('type') == 'text' for p in value), 'E_ORACLE_CONTENT'
    return '\n'.join(p['text'] for p in value)

def protocol(messages):
    pending=[]; seen=set()
    for message in messages:
        if message['role']=='tool':
            assert pending and message.get('tool_call_id')==pending.pop(0), 'E_ORACLE_TOOL_ID_ORDER'
        else:
            assert not pending, 'E_ORACLE_MISSING_TOOL'
            calls=message.get('tool_calls',[])
            for call in calls:
                assert call['id'] not in seen, 'E_ORACLE_DUPLICATE_CALL'
                seen.add(call['id']);pending.append(call['id'])
    assert not pending, 'E_ORACLE_MISSING_TOOL'

def same_json(left, right):
    """JSON equality must not confuse Python True with 1 or False with 0."""
    if left is None or right is None or isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    if type(left) is not type(right): return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(same_json(left[k], right[k]) for k in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(same_json(a,b) for a,b in zip(left,right))
    return isinstance(left, str) and left == right

def exact_retained(ingress, observed, marker, summary):
    """The fixture contracts permit replacing ONLY closed history before marker.
    Ingress is pre-transform evidence, observed is an independent network recorder.
    All untouched fields (including unknown metadata) must compare exactly.
    """
    raw=ingress['messages']
    cut=next(i for i,m in enumerate(raw) if m['role']=='user' and content_text(m.get('content'))==marker)
    protected=0
    while protected<len(raw) and raw[protected]['role'] in ('system','developer'):protected+=1
    expected=deepcopy(ingress)
    expected['messages']=deepcopy(raw[:protected])+[{'role':'assistant','content':summary}]+deepcopy(raw[cut:])
    assert same_json(observed,expected), 'E_ORACLE_RETAINED_PAYLOAD'
    protocol(observed['messages'])

def native_tools(history, wire):
    """Expected outputs are built from PUBLIC source records and a specified
    tool contract. Same count/content is not allowed to replace call identity.
    """
    expected={}
    for message in history:
        for part in message['parts']:
            if part['type']=='tool' and part['state']['status']=='completed':
                expected[part['callID']]=part['state']['output']
                if part['tool']=='cc_probe':
                    text='CC_TOOL_RESULT::'+message['info']['sessionID']+'::'+message['info']['id']+':local-test-only'
                    assert part['state']['output']==text, 'E_ORACLE_TOOL_IMPLEMENTATION'
    for message in wire:
        if message['role']=='tool':
            assert message['tool_call_id'] in expected, 'E_ORACLE_UNKNOWN_RESULT'
            assert content_text(message.get('content'))==expected[message['tool_call_id']], 'E_ORACLE_TOOL_CONTENT'
    protocol(wire)


def witnessed_sequence(ingress, observed, replacements):
    """Single-session fixture sequence. Expected bodies come from an external tap;
    only the explicitly selected whole-prefix replacements are allowed.
    """
    assert len(ingress)==len(observed) and ingress, 'E_ORACLE_WITNESS_COUNT'
    for original, output in zip(ingress, observed):
        raw=original['body']; candidates=[deepcopy(raw)]
        for marker,summary in replacements:
            assert isinstance(marker,str) and marker and isinstance(summary,str), 'E_ORACLE_WITNESS_PLAN'
            matches=[i for i,m in enumerate(raw['messages']) if m['role']=='user' and content_text(m.get('content'))==marker]
            if not matches:continue
            assert len(matches)==1, 'E_ORACLE_WITNESS_AMBIGUOUS_MARKER'
            cut=matches[0];prefix=0
            while prefix<len(raw['messages']) and raw['messages'][prefix]['role'] in ('system','developer'):prefix+=1
            assert cut>=prefix, 'E_ORACLE_WITNESS_CUT'
            candidate=deepcopy(raw)
            candidate['messages']=deepcopy(raw['messages'][:prefix])+[{'role':'assistant','content':summary}]+deepcopy(raw['messages'][cut:])
            candidates.append(candidate)
        assert any(same_json(output['body'],c) for c in candidates), 'E_ORACLE_WITNESS_PAYLOAD'
        protocol(output['body']['messages'])
